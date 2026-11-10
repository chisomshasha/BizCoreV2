"""
diagnose_users.py — find and (optionally) repair user accounts in MongoDB
that don't match the current schema (most commonly: a 'role' value that no
longer exists, e.g. the old "sales_executive" → now "sales_rep", or a
missing/incompatible password_hash left over from a pre-Mongo auth system).

USAGE
-----
Read-only report (always safe to run, makes no changes):

    python diagnose_users.py

Report AND auto-fix obvious legacy role renames (sales_executive -> sales_rep)
and flag (but not silently fix) anything else that needs a human decision:

    python diagnose_users.py --fix

Set MONGO_URL and DB_NAME as environment variables before running, exactly
as the main backend does — this script reads the same .env if present.
"""
import os
import sys
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

MONGO_URL = os.environ.get("MONGO_URL")
if not MONGO_URL:
    print("ERROR: MONGO_URL environment variable is not set. Set it to the same "
          "connection string the backend uses (Railway: copy it from the service's "
          "Variables tab, or from the Mongo plugin's 'Connect' panel).")
    sys.exit(1)
DB_NAME = os.environ.get("DB_NAME", "bizcore_db")

VALID_ROLES = {
    "super_admin", "general_manager", "warehouse_manager", "purchase_clerk",
    "sales_rep", "sales_clerk", "accountant", "viewer",
}

# Known historical → current role renames. Add to this dict if you find
# other legacy values during the audit below.
ROLE_RENAMES = {
    "sales_executive": "sales_rep",
}

VALID_HASH_PREFIX = "pbkdf2_sha256$"


async def main():
    fix_mode = "--fix" in sys.argv
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    users = await db.users.find({}, {"_id": 0}).to_list(10000)
    print(f"Loaded {len(users)} user document(s) from '{DB_NAME}.users'\n")

    bad_role = []
    bad_password = []
    fixable_role = []
    ok = []

    for u in users:
        uid = u.get("user_id", "?")
        uname = u.get("username") or u.get("email") or "?"
        role = u.get("role")
        pwd_hash = u.get("password_hash")

        role_problem = role not in VALID_ROLES
        pwd_problem = not pwd_hash or not isinstance(pwd_hash, str) or not pwd_hash.startswith(VALID_HASH_PREFIX)

        if role_problem and role in ROLE_RENAMES:
            fixable_role.append((uid, uname, role))
        elif role_problem:
            bad_role.append((uid, uname, role))

        if pwd_problem:
            bad_password.append((uid, uname, pwd_hash))

        if not role_problem and not pwd_problem:
            ok.append((uid, uname, role))

    print(f"✅ OK accounts (role valid, password_hash present and correctly formatted): {len(ok)}")
    for uid, uname, role in ok:
        print(f"    {uname:30} role={role}")

    print(f"\n🔁 Accounts with a KNOWN legacy role that can be auto-renamed: {len(fixable_role)}")
    for uid, uname, role in fixable_role:
        print(f"    {uname:30} role='{role}' -> '{ROLE_RENAMES[role]}'")

    print(f"\n❌ Accounts with an UNKNOWN/invalid role (needs a human decision): {len(bad_role)}")
    for uid, uname, role in bad_role:
        print(f"    {uname:30} role={role!r}")

    print(f"\n🔒 Accounts with a missing or incompatible password_hash (cannot log in at all): {len(bad_password)}")
    for uid, uname, pwd in bad_password:
        shown = (pwd[:20] + '...') if isinstance(pwd, str) and len(pwd) > 20 else pwd
        print(f"    {uname:30} password_hash={shown!r}")

    if not fix_mode:
        print(
            "\nThis was a READ-ONLY report. Re-run with --fix to:\n"
            "  1. Auto-rename known legacy roles (sales_executive -> sales_rep).\n"
            "  2. Leave everything else untouched for you to fix by hand "
            "(unknown roles and bad passwords are NOT auto-repaired, since "
            "guessing a role or password is unsafe)."
        )
        client.close()
        return

    if fixable_role:
        print(f"\nApplying {len(fixable_role)} auto-fix(es)...")
        for uid, uname, role in fixable_role:
            new_role = ROLE_RENAMES[role]
            await db.users.update_one({"user_id": uid}, {"$set": {"role": new_role}})
            print(f"    Fixed {uname}: role -> {new_role}")

    if bad_role:
        print(
            f"\n{len(bad_role)} account(s) still have an unrecognized role and were "
            "NOT changed. For each one, log in as a Super Admin, open Users, "
            "edit that account, and re-select a valid role from the dropdown."
        )

    if bad_password:
        print(
            f"\n{len(bad_password)} account(s) have no usable password and were "
            "NOT changed (this script will never invent a password for someone "
            "else). For each one, a Super Admin should either:\n"
            "  - Delete and recreate the account via the in-app Users screen "
            "(this generates a fresh temporary password), or\n"
            "  - Use a password-reset endpoint if one exists, or\n"
            "  - Manually set a new password_hash using the same hashing scheme "
            "as backend/server.py's hash_password() function."
        )

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
