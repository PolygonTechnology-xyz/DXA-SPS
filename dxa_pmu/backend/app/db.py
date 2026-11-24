from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

_settings = get_settings()
_settings.data_dir.mkdir(parents=True, exist_ok=True)

engine = create_engine(_settings.sqlalchemy_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db


def init_db() -> None:
    from . import models  # noqa: F401  (registers the tables)

    Base.metadata.create_all(engine)
    # create_all does not add columns to existing tables. Reports made before drafts existed count as final.
    from sqlalchemy import text
    with engine.begin() as c:
        c.execute(text("DROP TABLE IF EXISTS jira_mappings"))
        c.execute(text("ALTER TABLE risk_register ADD COLUMN IF NOT EXISTS source_ref VARCHAR(300)"))
        c.execute(text("ALTER TABLE reports ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'final'"))
        c.execute(text("ALTER TABLE reports ADD COLUMN IF NOT EXISTS final_pdf BYTEA"))
        c.execute(text("ALTER TABLE reports ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ"))
        c.execute(text("ALTER TABLE reports ADD COLUMN IF NOT EXISTS context JSON"))
        c.execute(text("ALTER TABLE reports ADD COLUMN IF NOT EXISTS style JSON"))
        c.execute(text("ALTER TABLE meetings ADD COLUMN IF NOT EXISTS style JSON"))
        c.execute(text("ALTER TABLE meetings ADD COLUMN IF NOT EXISTS format_id VARCHAR(36)"))
        c.execute(text("ALTER TABLE reports ADD COLUMN IF NOT EXISTS format_id VARCHAR(36)"))
        if c.execute(text("SELECT to_regclass('doc_templates')")).scalar():  # one format per kind became many
            c.execute(text("INSERT INTO doc_formats (id, project_id, kind, name, data, is_default, uploaded_at) "
                           "SELECT md5(random()::text || project_id || kind), project_id, kind, file_name, data, true, uploaded_at FROM doc_templates"))
            c.execute(text("DROP TABLE doc_templates"))
