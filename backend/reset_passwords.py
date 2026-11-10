"""
reset_passwords.py
==================

One-shot migration helper for the Supabase-→-direct-auth switch.

For every existing user in `db.users`:
  * Sets a brand-new PBKDF2-HMAC-SHA256 password hash.
  * Backfills the `username` field from the email's local-part if missing.
  * Prints the temporary password to stdout so the admin can share it.

The script does NOT delete any data. It only writes two fields. If a user
already has a `password_hash` it will be OVERWRITTEN — that is intentional
since the old Supabase hashes are not recoverable for password login.

Run it from the backend/ folder with the same env vars your FastAPI app uses:

    export MONGO_URL='mongodb+srv://...'
    export DB_NAME='bizcore_db'
    python3 reset_passwords.py [--out passwords.csv] [--length 12]

A `passwords.csv` is also written by default so you can keep a record.
The CSV has columns: user_id, name, email, username, password.
"""

import argparse
import asyncio
import csv
import hashlib
import os
import secrets
import string
import sys
from datetime import datetime, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient


# ---------------------------------------------------------------------------
# Password hashing — single source of truth, shared with server.py
# ---------------------------------------------------------------------------
from passwords import hash_password  # noqa: F401


def random_password(length: int = 12) -> str:
    """Strong random password using a shell-safe alphabet.

    No special characters — passwords with `$`, `!`, `*`, `?`, `^`, `=`, `+`
    get mangled when admins copy-paste them through bash / zsh / Windows
    terminal. Using letters + digits only is dramatically more reliable,
    and 12 random chars from a 62-char alphabet is still ~71 bits of
    entropy (about 2e21 combinations) — more than enough for an ERP.
    """
    alphabet = string.ascii_letters + string.digits   # a-z, A-Z, 0-9  (62 chars)
    return "".join(secrets.choice(alphabet) for _ in range(length))


# ---------------------------------------------------------------------------
# Username backfill rules
# ---------------------------------------------------------------------------
import re

_USERNAME_RE = re.compile(r"^[a-z0-9_.\-]{3,60}$")


def derive_username(email: str, existing: Optional[str]) -> str:
    """Return a valid username: existing if usable, else email's local-part."""
    if existing and _USERNAME_RE.match(existing.lower()):
        return existing.lower()
    base = email.split("@", 1)[0].lower()
    base = re.sub(r"[^a-z0-9_.\-]", "", base) or "user"
    return base[:60] if len(base) >= 3 else f"user_{base}"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out",
        default="passwords.csv",
        help="Where to write the (user_id, name, email, username, password) CSV.",
    )
    parser.add_argument(
        "--length",
        type=int,
        default=12,
        help="Length of generated passwords (min 8).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would change without writing anything.",
    )
    args = parser.parse_args()

    if args.length < 8:
        print("ERROR: --length must be at least 8", file=sys.stderr)
        return 2

    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        print("ERROR: MONGO_URL env var is not set.", file=sys.stderr)
        return 2
    db_name = os.environ.get("DB_NAME", "bizcore_db")

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    # Sanity: ensure the new indexes exist (idempotent).
    await db.users.create_index("email",    unique=True)
    await db.users.create_index("username", unique=True, sparse=True)

    # Pull every user — but only the fields we need, and skip the password_hash if any.
    cursor = db.users.find({}, {"_id": 0, "user_id": 1, "email": 1, "name": 1, "username": 1})

    rows = []
    now = datetime.now(timezone.utc)

    async for u in cursor:
        user_id = u.get("user_id")
        email   = (u.get("email") or "").strip().lower()
        name    = u.get("name") or email or user_id or "user"

        if not user_id or not email:
            print(f"SKIP (missing user_id/email): {u}", file=sys.stderr)
            continue

        username = derive_username(email, u.get("username"))
        new_pw   = random_password(args.length)
        new_hash = hash_password(new_pw)

        update = {
            "password_hash": new_hash,
            "username":      username,
            "updated_at":    now,
        }

        if args.dry_run:
            print(f"DRY-RUN would set {email} -> username={username} password={new_pw}")
        else:
            # If the derived username collides with another doc, fall back to a
            # suffixed one. Two updates on the same doc would otherwise raise.
            existing_username = await db.users.find_one(
                {"username": username, "user_id": {"$ne": user_id}}, {"_id": 1}
            )
            if existing_username:
                username = f"{username}_{secrets.token_hex(2)}"[:60]
                update["username"] = username

            await db.users.update_one({"user_id": user_id}, {"$set": update})
            print(f"OK  {email:50s} username={username:20s} password={new_pw}")

        rows.append({
            "user_id":  user_id,
            "name":     name,
            "email":    email,
            "username": username,
            "password": new_pw,
        })

    if args.dry_run:
        print(f"\nDRY-RUN: {len(rows)} user(s) would be updated. Nothing written.")
        return 0

    # Persist a CSV the admin can keep / share once.
    if rows:
        with open(args.out, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=["user_id", "name", "email", "username", "password"])
            writer.writeheader()
            writer.writerows(rows)
        print(f"\nWrote {len(rows)} row(s) to {args.out}")
        print("⚠️  Store this file somewhere SAFE and delete it after sharing credentials.")
    else:
        print("No users found — nothing to do.")

    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
