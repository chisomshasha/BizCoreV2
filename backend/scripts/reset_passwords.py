"""
reset_passwords.py — Reset a user's password from the command line.

Usage:
    python reset_passwords.py --email user@example.com --password 'NewPass123!'
    python reset_passwords.py --username admin --password 'NewPass123!'
    python reset_passwords.py --email user@example.com  # generates random password

Set MONGO_URL and DB_NAME as environment variables before running.
"""
import argparse
import asyncio
import os
import re
import secrets
import string
import sys
from pathlib import Path
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

# ── Hash helpers — single source of truth, shared with server.py ───────────
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from passwords import hash_password, random_password  # noqa: E402
# ────────────────────────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="Reset a user's password")
    parser.add_argument("--email",    help="User's email address")
    parser.add_argument("--username", help="User's username")
    parser.add_argument("--password", help="New password (>= 6 chars). If omitted, a random one is generated.")
    args = parser.parse_args()

    if not args.email and not args.username:
        print("ERROR: Provide --email or --username", file=sys.stderr)
        sys.exit(2)

    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        print("ERROR: MONGO_URL environment variable is not set.", file=sys.stderr)
        sys.exit(2)

    db_name = os.environ.get("DB_NAME", "bizcore_db")
    client  = AsyncIOMotorClient(mongo_url)
    db      = client[db_name]

    try:
        # Find the user
        query = {}
        if args.email:
            query["email"] = args.email.strip().lower()
        elif args.username:
            query["username"] = args.username.strip().lower()

        user = await db.users.find_one(query, {"_id": 0})
        if not user:
            print(f"ERROR: No user found matching {query}", file=sys.stderr)
            sys.exit(3)

        # Generate or validate password
        password = args.password or random_password()
        if len(password) < 6:
            print("ERROR: Password must be at least 6 characters.", file=sys.stderr)
            sys.exit(2)

        new_hash = hash_password(password)
        now = datetime.now(timezone.utc)

        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {
                "password_hash": new_hash,
                "is_active": True,
                "updated_at": now,
            }}
        )

        # Invalidate all existing sessions for this user
        deleted = await db.user_sessions.delete_many({"user_id": user["user_id"]})

        print(f"✅ Password reset for {user.get('name', 'Unknown')}")
        print(f"   user_id : {user['user_id']}")
        print(f"   username: {user.get('username', 'N/A')}")
        print(f"   email   : {user.get('email', 'N/A')}")
        print(f"   password: {password}")
        print(f"   sessions invalidated: {deleted.deleted_count}")
        print()
        print("The user must log in again with the new password.")
        if not args.password:
            print("Store the generated password somewhere safe — it is NOT recoverable.")

    finally:
        client.close()

if __name__ == "__main__":
    asyncio.run(main())
