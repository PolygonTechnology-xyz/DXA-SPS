"""The New project journey: the AI drafts a setup, a person checks it, and only then is the project created."""

from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from ..schemas import DraftChatIn, DraftChatOut, DraftDocumentOut
from ..services import ai, documents, drafts

router = APIRouter(prefix="/project-drafts", tags=["new project"])


@router.post("/document", response_model=DraftDocumentOut, response_model_by_alias=True)
async def draft_from_document(request: Request):
    """The raw file as the request body, with its name in the X-File-Name header (URL-encoded). Nothing is saved."""
    name = unquote(request.headers.get("x-file-name", "document"))[:200]
    data = bytearray()
    async for chunk in request.stream():  # stop early instead of holding a huge upload in memory
        data += chunk
        if len(data) > documents.MAX_BYTES:
            raise HTTPException(413, "That file is larger than 25 MB.")

    def work() -> DraftDocumentOut:
        try:
            text, pages, read, trimmed = drafts.read_document(name, bytes(data))
        except documents.DocProblem as e:
            raise HTTPException(422, str(e)) from None
        found = ai.draft_setup_from_document(name, text)
        return DraftDocumentOut(draft=drafts.clean(found.model_dump(), read), file_name=name, size=len(data),
                                pages=pages, pages_read=read, trimmed=trimmed)

    return await run_in_threadpool(work)  # reading the file and waiting for the AI must not block other requests


@router.post("/chat", response_model=DraftChatOut, response_model_by_alias=True)
def draft_chat(body: DraftChatIn):
    """One turn of describing a project. Send the whole conversation and the draft as it stands."""
    current = body.draft.model_dump()
    turn = ai.setup_chat_turn([m.model_dump() for m in body.messages], current)
    # pages are only ever carried over from the current draft (see merge_chat), never taken from the chat
    after = drafts.clean(turn.draft.model_dump(), None)
    return DraftChatOut(reply=turn.reply, draft=drafts.merge_chat(body.draft, after))
