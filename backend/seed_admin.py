"""
seed_admin.py
=============

Bootstrap the FIRST super-admin user from the command line.

This is the recommended path for provisioning the very first account on a
fresh database. Once a super_admin exists, every further account is created
from the in-app **Users** screen (More → Team Members), which enforces the
role hierarchy and writes the audit trail.

Usage (from the backend/ folder):

    export MONGO_URL='mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/?retryWrites=true&w=majority'
    export DB_NAME='bizcore_db'

    python seed_admin.py \\
        --username admin \\
        --email admin@yourcompany.ng \\
        --phone '+2348012345678' \\
        --name 'Initial Admin'

    # ...or let it generate a strong username and password for you:
    python seed_admin.py --email admin@yourcompany.ng

Behaviour
---------
  * A super_admin already exists  → the script refuses and exits (exit 3).
  * Users exist but none is a super_admin → the earliest user is **promoted**
    to super_admin and given a fresh password.
  * The database is empty → a brand-new super_admin is created.

Password rules
--------------
  * Passwords are hashed with PBKDF2-HMAC-SHA256 (200k iterations) using the
    same helper the API uses (`backend/passwords.py`), so the account can
    sign in to the app immediately.
  * The password is printed once and is **not recoverable**. Store it now.
"""

import argparse
import asyncio
import os
import re
import secrets
import sys
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from passwords import hash_password, random_password  # noqa: E402


async def main():
    parser = argparse.ArgumentParser(
        description="Seed the first super-admin account for BizCore.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--username", help="Login username (lowercase, 3-60 chars).")
    parser.add_argument("--email", help="Email address (required).")
    parser.add_argument("--phone", help="Phone number, e.g. +2348012345678.")
    parser.add_argument("--password", help="Initial password (>=6 chars).")
    parser.add_argument("--name", help="Display name.")
    args = parser.parse_args()

    mongo_url = os.environ.get("MONGO_URL")
    if not mongo_url:
        print("ERROR: MONGO_URL environment variable is not set.", file=sys.stderr)
        sys.exit(2)

    db_name = os.environ.get("DB_NAME", "bizcore_db")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    try:
        # Ensure indexes (idempotent)
        await db.users.create_index("email", unique=True)
        await db.users.create_index("username", unique=True, sparse=True)

        # Seed the role-permission matrix so the admin screen is populated
        # even before the API has booted for the first time.
        try:
            from permissions import seed_default_permissions
            await seed_default_permissions(db)
        except Exception as exc:
            print(f"WARNING: could not seed role permissions: {exc}", file=sys.stderr)

        existing_admins = await db.users.count_documents({"role": "super_admin"})
        if existing_admins > 0:
            print(
                "ERROR: a super_admin already exists in the database.\n"
                "Create additional accounts via the in-app Users screen "
                "(More → Team Members).",
                file=sys.stderr,
            )
            sys.exit(3)

        now = datetime.now(timezone.utc)

        # ── Promotion path: users exist but none is an admin ───────────────
        user_count = await db.users.count_documents({})
        if user_count > 0:
            if not args.password:
                print(
                    "ERROR: --password is required when promoting an existing "
                    "user to super_admin (the account already has a password).",
                    file=sys.stderr,
                )
                sys.exit(2)
            existing = await db.users.find_one(
                {}, {"_id": 0, "user_id": 1, "username": 1, "email": 1, "name": 1}
            )
            await db.users.update_one(
                {"user_id": existing["user_id"]},
                {"$set": {
                    "role": "super_admin",
                    "is_active": True,
                    "password_hash": hash_password(args.password),
                    "updated_at": now,
                }},
            )
            print("✅ Existing user promoted to super-admin")
            print(f"   user_id : {existing['user_id']}")
            print(f"   username: {existing.get('username') or existing.get('email')}")
            print(f"   email   : {existing.get('email')}")
            print(f"   password: {args.password}")
            print()
            print("Store the password somewhere safe — it is NOT recoverable.")
            return

        # ── Fresh database: create the first super-admin ────────────────────
        email = (args.email or "").strip().lower()
        if not email or "@" not in email:
            print("ERROR: --email is required and must be a valid address.", file=sys.stderr)
            sys.exit(2)

        username = (args.username or email.split("@")[0]).strip().lower()
        if not re.match(r"^[a-z0-9_.\-]{3,60}$", username):
            print(
                "ERROR: username must match ^[a-z0-9_.-]{3,60}$",
                file=sys.stderr,
            )
            sys.exit(2)

        if await db.users.find_one({"$or": [{"email": email}, {"username": username}]}, {"_id": 1}):
            print("ERROR: a user with that email or username already exists.", file=sys.stderr)
            sys.exit(4)

        password = args.password or random_password(16)
        if len(password) < 6:
            print("ERROR: password must be at least 6 characters.", file=sys.stderr)
            sys.exit(2)

        name = (args.name or username).strip()
        phone = (args.phone or "").strip() or None

        user_id = f"user_{secrets.token_hex(12)}"
        doc = {
            "user_id":       user_id,
            "username":      username,
            "email":         email,
            "name":          name,
            "phone":         phone,
            "role":          "super_admin",
            "warehouse_id":  None,
            "warehouse_name": None,
            "is_active":     True,
            "is_invited":    False,
            "debt_ceiling":  0.0,
            "is_flagged":    False,
            "password_hash": hash_password(password),
            "created_at":    now,
            "updated_at":    now,
        }
        await db.users.insert_one(doc)

        print("✅ Super-admin account created")
        print(f"   user_id : {user_id}")
        print(f"   username: {username}")
        print(f"   email   : {email}")
        print(f"   name    : {name}")
        print(f"   password: {password}")
        print()
        print("Store the password somewhere safe — it is NOT recoverable.")
        print("Sign in with the username (or the email) and this password.")
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
