import os
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from jose import JWTError, jwt

from db import connect as db_connect

load_dotenv()

GOOGLE_CLIENT_ID: str = os.environ["GOOGLE_CLIENT_ID"]
JWT_SECRET: str = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 7

if len(JWT_SECRET) < 32:
    raise RuntimeError(
        "JWT_SECRET must be at least 32 characters long. Generate one with: "
        'python -c "import secrets; print(secrets.token_urlsafe(32))"'
    )

_security = HTTPBearer()


def verify_google_token(raw_token: str) -> dict:
    idinfo = google_id_token.verify_oauth2_token(
        raw_token,
        google_requests.Request(),
        GOOGLE_CLIENT_ID,
    )
    if not idinfo.get("email_verified"):
        raise ValueError("Google account email is not verified")
    return {
        "email": idinfo["email"],
        "google_sub": idinfo["sub"],
        "display_name": idinfo.get("name", ""),
        "given_name": idinfo.get("given_name", ""),
        "avatar_url": idinfo.get("picture", ""),
    }


def create_app_jwt(
    user_id: int,
    email: str,
    display_name: str,
    given_name: str,
    avatar_url: str,
    is_admin: bool,
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "display_name": display_name,
        "given_name": given_name,
        "avatar_url": avatar_url,
        "is_admin": is_admin,
        "iat": now,
        "exp": now + timedelta(days=JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _env_admin_emails() -> set[str]:
    return {e.strip() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_security),
) -> dict:
    try:
        payload = jwt.decode(
            credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM]
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    # Re-check the DB on every request rather than trusting the (up to 7-day)
    # JWT alone: removing an email from the whitelist, or deleting the user
    # row, must lock the holder out immediately, not at token expiry.
    user_id = int(payload["sub"])
    email = payload.get("email") or ""
    async with db_connect() as db:
        async with db.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)) as cur:
            user_exists = await cur.fetchone() is not None
        allowed = email in _env_admin_emails()
        if user_exists and not allowed:
            async with db.execute(
                "SELECT 1 FROM allowed_emails WHERE email = ?", (email,)
            ) as cur:
                allowed = await cur.fetchone() is not None
    if not user_exists or not allowed:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Access revoked",
        )
    return payload


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    # Re-checks the DB rather than trusting the JWT's is_admin claim, so that
    # revoking admin via PATCH /admin/users/{id}/admin takes effect immediately
    # instead of waiting up to JWT_EXPIRY_DAYS for the old token to expire.
    async with db_connect() as db:
        async with db.execute(
            "SELECT is_admin FROM users WHERE id = ?", (int(user["sub"]),)
        ) as cur:
            row = await cur.fetchone()
    if not row or not row[0]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
