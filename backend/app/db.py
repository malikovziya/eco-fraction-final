"""SQLite storage. The database is rebuilt whenever the contracts are redeployed, because a
fresh chain invalidates every wallet balance and batch id the old database refers to."""

import json
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from .config import DATA_DIR, DEPLOYMENT_FILE

engine = create_engine(
    f"sqlite:///{DATA_DIR / 'eco.db'}",
    connect_args={"check_same_thread": False, "timeout": 30},
)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Meta(Base):
    __tablename__ = "meta"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String, unique=True)
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    role: Mapped[str] = mapped_column(String)  # investor | producer | signer
    persona: Mapped[str | None] = mapped_column(String, nullable=True)  # persona key for one-click login
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    wallet_address: Mapped[str] = mapped_column(String, unique=True)
    wallet_key_enc: Mapped[str | None] = mapped_column(Text, nullable=True)  # None = derived from dev mnemonic
    wallet_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kyc_status: Mapped[str] = mapped_column(String, default="none")  # none | pending | verified
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False)  # background market participant
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SessionToken(Base):
    __tablename__ = "sessions"
    token: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Reading(Base):
    __tablename__ = "readings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[str] = mapped_column(String, index=True)
    ts: Mapped[str] = mapped_column(String, index=True)  # simulated ISO time
    power_kw: Mapped[float] = mapped_column(Float)
    energy_kwh: Mapped[float] = mapped_column(Float)
    fraud_prob: Mapped[float] = mapped_column(Float)
    degrade_prob: Mapped[float] = mapped_column(Float)
    predicted_class: Mapped[str] = mapped_column(String)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("batches.id"), nullable=True, index=True)
    raw: Mapped[str] = mapped_column(Text)  # exact signed device message, for hash verification


class Rejection(Base):
    __tablename__ = "rejections"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[str] = mapped_column(String, index=True)
    reason: Mapped[str] = mapped_column(String)
    ts: Mapped[str | None] = mapped_column(String, nullable=True)
    claimed_power_kw: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Batch(Base):
    __tablename__ = "batches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[str] = mapped_column(String, index=True)
    token_id: Mapped[int] = mapped_column(Integer)
    period_start: Mapped[str] = mapped_column(String)
    period_end: Mapped[str] = mapped_column(String)
    readings_count: Mapped[int] = mapped_column(Integer)
    energy_wh: Mapped[int] = mapped_column(Integer)
    data_hash: Mapped[str] = mapped_column(String)
    anomaly_score: Mapped[int] = mapped_column(Integer)  # basis points
    suspicious_readings: Mapped[int] = mapped_column(Integer)
    flagged: Mapped[bool] = mapped_column(Boolean)
    verdict: Mapped[str] = mapped_column(String)  # normal | inflate | flatline | degrade
    explanation: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending|distributed|escrowed|released|refunded|failed
    chain_batch_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    revenue_usdc: Mapped[float | None] = mapped_column(Float, nullable=True)
    tx_record: Mapped[str | None] = mapped_column(String, nullable=True)
    tx_settle: Mapped[str | None] = mapped_column(String, nullable=True)
    tx_payout: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[str] = mapped_column(String, index=True)
    kind: Mapped[str] = mapped_column(String)  # fraud | maintenance | security
    severity: Mapped[str] = mapped_column(String)  # high | medium | low
    title: Mapped[str] = mapped_column(String)
    detail: Mapped[str] = mapped_column(Text)
    title_tr: Mapped[str | None] = mapped_column(String, nullable=True)
    detail_tr: Mapped[str | None] = mapped_column(Text, nullable=True)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("batches.id"), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Activity(Base):
    """User-facing ledger: purchases, payouts, deposits, trades — each linked to its transaction."""

    __tablename__ = "activity"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String)  # deposit | buy | payout | kyc | sell | trade_buy
    asset_id: Mapped[str | None] = mapped_column(String, nullable=True)
    shares: Mapped[int | None] = mapped_column(Integer, nullable=True)
    amount_usdc: Mapped[float | None] = mapped_column(Float, nullable=True)
    tx_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Trade(Base):
    """Secondary-market fills, mirrored from the Marketplace contract's Traded events."""

    __tablename__ = "trades"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    listing_id: Mapped[int] = mapped_column(Integer, index=True)
    asset_id: Mapped[str] = mapped_column(String, index=True)
    shares: Mapped[int] = mapped_column(Integer)
    price_usdc: Mapped[float] = mapped_column(Float)
    cost_usdc: Mapped[float] = mapped_column(Float)
    fee_usdc: Mapped[float] = mapped_column(Float)
    buyer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    seller_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    tx_hash: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class HourlyEnergy(Base):
    """Hourly capacity ratio per asset: LSTM input history and ESG performance data."""

    __tablename__ = "hourly_energy"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    asset_id: Mapped[str] = mapped_column(String, index=True)
    hour: Mapped[str] = mapped_column(String, index=True)  # simulated ISO hour start
    energy_kwh: Mapped[float] = mapped_column(Float)
    ratio: Mapped[float] = mapped_column(Float)  # energy / (capacity × 1h)
    backfilled: Mapped[bool] = mapped_column(Boolean, default=False)


def deployment_marker() -> str:
    return json.loads(DEPLOYMENT_FILE.read_text())["deployedAt"]


def init_db() -> bool:
    """Create tables; wipe everything if the chain was redeployed. Returns True if reset."""
    Base.metadata.create_all(engine)
    marker = deployment_marker()
    with Session(engine) as s:
        current = s.get(Meta, "deployment")
        if current and current.value == marker:
            return False
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with Session(engine) as s:
        s.add(Meta(key="deployment", value=marker))
        s.commit()
    return True


def get_meta(s: Session, key: str) -> str | None:
    row = s.scalar(select(Meta).where(Meta.key == key))
    return row.value if row else None
