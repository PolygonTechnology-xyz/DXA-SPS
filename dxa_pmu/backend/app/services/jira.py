"""Jira Cloud access (REST v3, email + API token)."""

from __future__ import annotations

import ipaddress
import socket
from typing import Any
from urllib.parse import urlparse

import httpx


class JiraError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def parse_site(raw: str) -> str:
    """Normalise a Jira address to https://host. Only public https hosts are accepted, so this
    can't be pointed at internal services (SSRF)."""
    raw = (raw or "").strip()
    u = urlparse(raw if "://" in raw else f"https://{raw}")
    host = (u.hostname or "").lower()
    bad = (
        u.scheme != "https" or not host or "." not in host or host == "localhost"
        or host.endswith((".local", ".internal", ".localhost", ".lan"))
    )
    if not bad:
        try:
            ipaddress.ip_address(host)
            bad = True  # IP literals are refused
        except ValueError:
            pass
    if bad:
        raise JiraError(400, "Enter your Jira address as a secure link, for example https://your-company.atlassian.net.")
    # Refuse hosts that resolve to private networks too.
    try:
        for info in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP):
            ip = ipaddress.ip_address(info[4][0])
            if not ip.is_global:
                raise JiraError(400, "That Jira address points to a private network and cannot be used.")
    except socket.gaierror:
        raise JiraError(502, "Could not reach Jira. Check the address and your internet connection.") from None
    return f"https://{host}"


def _get(client: httpx.Client, site: str, path: str, **params: Any) -> httpx.Response:
    return client.get(f"{site}{path}", params=params or None)


def fetch(site_url: str, email: str, token: str, project_key: str) -> dict[str, Any]:
    """Verify the login and project, then pull the project's tasks.

    Returns {"user": str, "project_name": str, "tasks": [...]}. Raises JiraError with a
    message that is safe to show to the end user.
    """
    site = parse_site(site_url)
    key = project_key.strip().upper()
    if not email.strip() or not token.strip() or not key:
        raise JiraError(400, "Please fill in every field.")
    if not (key[0].isalpha() and key.replace("_", "").isalnum() and 2 <= len(key) <= 50):
        raise JiraError(400, "The project key should be letters and numbers only, like KAN.")

    try:
        with httpx.Client(
            auth=(email.strip(), token.strip()), headers={"Accept": "application/json"},
            timeout=10.0, follow_redirects=False,
        ) as c:
            me = _get(c, site, "/rest/api/3/myself")
            if me.status_code in (401, 403):
                raise JiraError(401, "Jira did not accept that email and API token. Check both and try again.")
            if me.status_code != 200:
                raise JiraError(502, f"Jira answered with an unexpected error ({me.status_code}). Check the address and try again.")
            user = me.json().get("displayName") or email

            proj = _get(c, site, f"/rest/api/3/project/{key}")
            if proj.status_code == 404:
                raise JiraError(404, f'Connected, but there is no project with the key "{key}", or you cannot see it.')
            if proj.status_code != 200:
                raise JiraError(502, f'Connected, but Jira would not return project "{key}" ({proj.status_code}).')

            return {
                "user": user, "project_name": proj.json().get("name") or key,
                "tasks": _tasks(c, site, key), "milestones": _versions(c, site, key),
            }
    except httpx.HTTPError:
        raise JiraError(502, "Could not reach Jira. Check the address and your internet connection.") from None


def adf_text(node: Any) -> str:
    """Plain text from Jira's Atlassian Document Format (descriptions are ADF in REST v3)."""
    if isinstance(node, str):
        return node
    if not isinstance(node, dict):
        return ""
    if node.get("type") == "text":
        return node.get("text", "")
    if node.get("type") == "hardBreak":
        return "\n"
    parts = [adf_text(c) for c in node.get("content", [])]
    sep = "\n" if node.get("type") in ("doc", "bulletList", "orderedList", "listItem") else ""
    out = sep.join(x for x in parts if x) if sep else "".join(parts)
    return out + ("\n" if node.get("type") in ("paragraph", "heading", "codeBlock") else "")


def _tasks(c: httpx.Client, site: str, key: str, limit: int = 500) -> list[dict[str, Any]]:
    """Best effort: a failure here must not turn a working connection into an error."""
    out: list[dict[str, Any]] = []
    token: str | None = None
    try:
        while len(out) < limit:
            params: dict[str, Any] = {
                "jql": f'project = "{key}" ORDER BY created DESC',
                "fields": "summary,description,status,assignee,priority,issuetype,duedate,fixVersions,issuelinks,parent",
                "maxResults": 100,
            }
            if token:
                params["nextPageToken"] = token
            r = _get(c, site, "/rest/api/3/search/jql", **params)
            if r.status_code != 200:
                break
            data = r.json()
            for i in data.get("issues", []):
                f = i.get("fields", {})
                blocked_by, blocks = _links(f.get("issuelinks"))
                parent = f.get("parent") or {}
                ptype = (parent.get("fields") or {}).get("issuetype") or {}
                # An epic is the level above tasks. Team-managed projects may rename it (e.g. "Workstream").
                is_epic = ptype.get("name", "").lower() in ("epic", "workstream") or ptype.get("hierarchyLevel") == 1
                out.append({
                    "key": i["key"],
                    "summary": f.get("summary") or "",
                    "description": adf_text(f.get("description")).strip()[:2000] or None,
                    "status": (f.get("status") or {}).get("name", "Unknown"),
                    "category": ((f.get("status") or {}).get("statusCategory") or {}).get("key", "new"),
                    "assignee": (f.get("assignee") or {}).get("displayName"),
                    "priority": (f.get("priority") or {}).get("name"),
                    "type": (f.get("issuetype") or {}).get("name", "Task"),
                    "due": f.get("duedate"),
                    "versions": [v["name"] for v in f.get("fixVersions") or [] if v.get("name")],
                    "blockedBy": blocked_by,
                    "blocks": blocks,
                    "epic": parent.get("key") if is_epic else None,
                })
            token = data.get("nextPageToken")
            if data.get("isLast", True) or not token:
                break
    except (httpx.HTTPError, ValueError, KeyError):
        pass
    return out[:limit]


def _links(links: Any) -> tuple[list[str], list[str]]:
    """Dependencies from Jira's "Blocks" link type: (issues blocking this one, issues this one blocks)."""
    blocked_by: list[str] = []
    blocks: list[str] = []
    for ln in links or []:
        if ((ln.get("type") or {}).get("name") or "").lower() != "blocks":
            continue
        if ln.get("inwardIssue"):  # "is blocked by"
            blocked_by.append(ln["inwardIssue"]["key"])
        elif ln.get("outwardIssue"):  # "blocks"
            blocks.append(ln["outwardIssue"]["key"])
    return blocked_by, blocks


def _versions(c: httpx.Client, site: str, key: str) -> list[dict[str, Any]] | None:
    """The project's Jira versions as milestones (those with a release date). None if Jira would not say,
    so a failed call never wipes milestones we already have."""
    try:
        r = _get(c, site, f"/rest/api/3/project/{key}/versions")
        if r.status_code != 200:
            return None
        return sorted(
            ({"title": v["name"], "due": v["releaseDate"], "done": bool(v.get("released"))}
             for v in r.json() if v.get("name") and v.get("releaseDate")),
            key=lambda m: m["due"],
        )
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return None
