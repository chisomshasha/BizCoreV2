"""
Password hashing — the single source of truth for BizCore.

This module exists so that the API server and the provisioning scripts
(`seed_admin.py`, `reset_passwords.py`, `scripts/reset_passwords.py`) can
never drift apart. Previously the PBKDF2 routine was copy-pasted into four
files; a change to the iteration count in one of them would silently produce
password hashes that the login endpoint could not verify.

Scheme: PBKDF2-HMAC-SHA256, 200,000 iterations, 16-byte random salt.
Stored as:  pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
"""

import hashlib
import hmac
import secrets
import string

_PBKDF2_ITERATIONS = 200_000
_PBKDF2_ALGO = "sha256"
_SALT_BYTES = 16

MIN_PASSWORD_LENGTH = 6


def hash_password(plain: str) -> str:
    """Hash a password with a per-user random salt.

    Returns ``pbkdf2_sha256$<iters>$<salt_hex>$<hash_hex>``.
    """
    if plain is None or len(plain) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    salt = secrets.token_bytes(_SALT_BYTES)
    dk = hashlib.pbkdf2_hmac(_PBKDF2_ALGO, plain.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(plain: str, stored: str) -> bool:
    """Constant-time comparison of a plaintext password to a stored hash."""
    try:
        algo, iters_s, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        iters = int(iters_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
        candidate = hashlib.pbkdf2_hmac(_PBKDF2_ALGO, plain.encode("utf-8"), salt, iters)
        return hmac.compare_digest(candidate, expected)
    except Exception:
        return False


def random_password(length: int = 16, symbols: bool = True) -> str:
    """Generate a strong random password.

    With ``symbols=False`` the alphabet is letters + digits only — much
    easier for an admin to copy-paste through a terminal without the shell
    eating `$`, `!` or `*`.
    """
    alpha = string.ascii_letters + string.digits
    if symbols:
        alpha += "!@#%^*?-_=+"
    return "".join(secrets.choice(alpha) for _ in range(length))
