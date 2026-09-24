from collections.abc import Iterator

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..db import SessionLocal, SessionToken, User


def get_db() -> Iterator[Session]:
    with SessionLocal() as s:
        yield s


def current_user(authorization: str | None = Header(default=None), s: Session = Depends(get_db)) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not signed in")
    session = s.get(SessionToken, authorization.removeprefix("Bearer "))
    if session is None:
        raise HTTPException(401, "Session expired")
    return s.get(User, session.user_id)


def require_role(*roles: str):
    def check(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, f"Requires role: {', '.join(roles)}")
        return user

    return check
