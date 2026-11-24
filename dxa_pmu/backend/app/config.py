from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # PostgreSQL (the `db` service in docker-compose.yml). Plain postgresql:// URLs are fine.
    database_url: str = "postgresql://postgres:postgres@localhost:5432/dxa_pmu"
    data_dir: Path = Path("data")

    # Key used to encrypt saved Jira API tokens (a Fernet key). If empty, one is
    # generated once and kept in data/secret.key so tokens survive restarts.
    secret_key: str = ""

    anthropic_api_key: str | None = None  # falls back to the SDK's own credential lookup
    anthropic_organization_id: str | None = None  # sent as the anthropic-organization-id header when set
    anthropic_model: str = "claude-opus-5-5"
    anthropic_fallbacks: bool = True  # server-side refusal fallback; see services/ai.py

    cors_origins: str = "http://localhost:3000"

    scheduler_enabled: bool = True
    scheduler_interval_minutes: int = 60
    jira_sync_enabled: bool = True  # re-import every connected project's tasks on a timer (read-only)
    jira_sync_interval_minutes: int = 360  # every 6 hours

    @property
    def sqlalchemy_url(self) -> str:
        url = self.database_url
        # docker-compose hands out plain postgresql:// URLs; use the psycopg 3 driver.
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+psycopg://", 1)
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql+psycopg://", 1)
        return url  # already has an explicit driver, e.g. postgresql+psycopg://

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
