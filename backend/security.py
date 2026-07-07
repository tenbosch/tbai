from fastapi import Request
from jose import JWTError, jwt
from slowapi import Limiter
from slowapi.util import get_remote_address

from auth import JWT_ALGORITHM, JWT_SECRET


def get_client_ip(request: Request) -> str:
    """Resolves the real client IP behind the Cloudflare Tunnel.

    All traffic arrives via Cloudflare -> Vite proxy -> uvicorn, so
    request.client.host is always 127.0.0.1. Trusting CF-Connecting-IP /
    X-Forwarded-For here is safe only because the backend and Vite are bound
    to loopback and reachable exclusively through the local Cloudflare
    Tunnel — if that binding is ever widened back to 0.0.0.0, these headers
    become spoofable by any direct caller.
    """
    return (
        request.headers.get("CF-Connecting-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or get_remote_address(request)
    )


def get_user_or_ip(request: Request) -> str:
    """Keys rate limits by authenticated user so one account's usage never
    throttles another user sharing the same IP behind the tunnel."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[len("Bearer "):]
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            return f"user:{payload['sub']}"
        except JWTError:
            pass
    return get_client_ip(request)


limiter = Limiter(key_func=get_client_ip)
