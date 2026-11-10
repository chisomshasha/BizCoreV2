"""
Regression tests for the provisioning scripts.

These run the real scripts (seed_admin, reset_passwords) against an in-memory
MongoDB and then prove the accounts they create can actually sign in through
the API. A seeding script that writes a hash the login endpoint cannot
verify is worse than no script at all, so that is exactly what we check.
"""
import asyncio
import importlib.util
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).parent
sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "bizcore_seed_test")
os.environ.setdefault("LOGIN_RATE_LIMIT", "1000/minute")

import pytest  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402


@pytest.fixture(scope="module")
def seeded():
    """Run seed_admin.py against a fresh in-memory database."""
    import motor.motor_asyncio as motor_mod
    from fastapi.testclient import TestClient

    fake = AsyncMongoMockClient()
    original = motor_mod.AsyncIOMotorClient
    motor_mod.AsyncIOMotorClient = lambda *a, **k: fake

    # The script reads DB_NAME from the environment, and the acceptance
    # suite's own fixture also sets it — pin it for the duration of this
    # module and restore it afterwards.
    previous_db_name = os.environ.get("DB_NAME")
    os.environ["DB_NAME"] = "bizcore_seed_test"

    try:
        spec = importlib.util.spec_from_file_location(
            "seed_admin_under_test", BACKEND_DIR / "seed_admin.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        argv = sys.argv
        sys.argv = ["seed_admin.py", "--email", "admin@bizcore.ng",
                    "--username", "admin", "--phone", "+2348012345678",
                    "--name", "Initial Admin", "--password", "Sup3rStrong!"]
        try:
            asyncio.run(mod.main())
        finally:
            sys.argv = argv

        import server as srv
        prev_client, prev_db = srv.client, srv.db
        srv.client = fake
        srv.db = fake["bizcore_seed_test"]
        try:
            with TestClient(srv.app, raise_server_exceptions=False) as c:
                yield {"client": c, "db": fake["bizcore_seed_test"], "mod": mod}
        finally:
            srv.client, srv.db = prev_client, prev_db
    finally:
        motor_mod.AsyncIOMotorClient = original
        if previous_db_name is None:
            os.environ.pop("DB_NAME", None)
        else:
            os.environ["DB_NAME"] = previous_db_name


def test_seed_admin_creates_a_usable_super_admin(seeded):
    db = seeded["db"]

    async def read():
        return await db.users.find_one({"username": "admin"})

    doc = asyncio.run(read())
    assert doc is not None, "the super-admin was not created"
    assert doc["role"] == "super_admin"
    assert doc["is_active"] is True
    assert doc["phone"] == "+2348012345678", "the phone number was not stored"
    assert doc["email"] == "admin@bizcore.ng"
    assert doc["name"] == "Initial Admin"
    assert "password_hash" in doc


def test_seeded_admin_can_sign_in_through_the_api(seeded):
    """The whole point of the script: the account must work in the app."""
    c = seeded["client"]
    r = c.post("/api/auth/login",
               json={"username": "admin", "password": "Sup3rStrong!"})
    assert r.status_code == 200, f"{r.status_code}: {r.text}"
    body = r.json()
    assert body["user"]["role"] == "super_admin"
    assert body["session_token"].startswith("sess_")

    # ...and by email too.
    r = c.post("/api/auth/login",
               json={"username": "admin@bizcore.ng", "password": "Sup3rStrong!"})
    assert r.status_code == 200

    # ...and the session really works.
    r = c.get("/api/auth/me", headers={"Authorization": f"Bearer {body['session_token']}"})
    assert r.status_code == 200
    assert r.json()["username"] == "admin"


def test_seed_admin_seeds_the_role_permission_matrix(seeded):
    db = seeded["db"]

    async def roles():
        return [r["role"] async for r in db.role_permissions.find({})]

    found = asyncio.run(roles())
    assert "super_admin" in found
    assert "sales_rep" in found


def test_seed_admin_refuses_when_an_admin_already_exists(seeded, capsys):
    """Running it twice must not create a second super-admin."""
    import motor.motor_asyncio as motor_mod

    fake = AsyncMongoMockClient()
    previous_db_name = os.environ.get("DB_NAME")
    os.environ["DB_NAME"] = "bizcore_seed_test"

    async def _seed_dup():
        await fake["bizcore_seed_test"].users.insert_one({
            "user_id": "u_dup", "username": "other", "email": "other@bizcore.ng",
            "name": "Other", "role": "super_admin", "is_active": True,
            "password_hash": "x", "created_at": None, "updated_at": None,
        })

    asyncio.run(_seed_dup())
    original = motor_mod.AsyncIOMotorClient
    motor_mod.AsyncIOMotorClient = lambda *a, **k: fake
    try:
        spec = importlib.util.spec_from_file_location(
            "seed_admin_dup", BACKEND_DIR / "seed_admin.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        argv = sys.argv
        sys.argv = ["seed_admin.py", "--email", "second@bizcore.ng"]
        code = None
        try:
            asyncio.run(mod.main())
        except SystemExit as e:
            code = e.code
        finally:
            sys.argv = argv
        assert code == 3, f"expected exit code 3 (admin exists), got {code}"
    finally:
        motor_mod.AsyncIOMotorClient = original
        if previous_db_name is None:
            os.environ.pop("DB_NAME", None)
        else:
            os.environ["DB_NAME"] = previous_db_name


def test_seed_admin_promotes_an_existing_user_when_no_admin_exists():
    """The documented behaviour: users exist but nobody is an admin yet."""
    import motor.motor_asyncio as motor_mod

    fake = AsyncMongoMockClient()
    previous_db_name = os.environ.get("DB_NAME")
    os.environ["DB_NAME"] = "bizcore_promote_test"

    async def _seed():
        await fake["bizcore_promote_test"].users.insert_one({
            "user_id": "u_early", "username": "early", "email": "early@b.ng",
            "name": "Early Bird", "role": "sales_rep", "is_active": True,
            "password_hash": "old", "created_at": None, "updated_at": None,
        })

    asyncio.run(_seed())
    original = motor_mod.AsyncIOMotorClient
    motor_mod.AsyncIOMotorClient = lambda *a, **k: fake
    try:
        spec = importlib.util.spec_from_file_location(
            "seed_admin_promote", BACKEND_DIR / "seed_admin.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        argv = sys.argv
        sys.argv = ["seed_admin.py", "--password", "Promoted!123"]
        try:
            asyncio.run(mod.main())
        finally:
            sys.argv = argv

        async def read():
            return await fake["bizcore_promote_test"].users.find_one({"user_id": "u_early"})

        doc = asyncio.run(read())
        assert doc["role"] == "super_admin", doc["role"]
        assert doc["is_active"] is True
        # the fresh password must actually work
        assert mod.hash_password("Promoted!123")
        from passwords import verify_password
        assert verify_password("Promoted!123", doc["password_hash"]) is True
    finally:
        motor_mod.AsyncIOMotorClient = original
        if previous_db_name is None:
            os.environ.pop("DB_NAME", None)
        else:
            os.environ["DB_NAME"] = previous_db_name


def test_reset_passwords_script_writes_usable_hashes(tmp_path):
    """The bulk reset script must produce hashes the API can verify."""
    import motor.motor_asyncio as motor_mod
    from passwords import verify_password

    fake = AsyncMongoMockClient()
    previous_db_name = os.environ.get("DB_NAME")
    os.environ["DB_NAME"] = "bizcore_reset_test"

    async def _seed():
        await fake["bizcore_reset_test"].users.insert_many([
            {"user_id": "u1", "username": "ada", "email": "ada@b.ng", "name": "Ada",
             "role": "sales_rep", "is_active": True, "password_hash": "legacy",
             "created_at": None, "updated_at": None},
            {"user_id": "u2", "email": "bob@b.ng", "name": "Bob", "role": "viewer",
             "is_active": True, "password_hash": "legacy",
             "created_at": None, "updated_at": None},
        ])

    asyncio.run(_seed())
    original = motor_mod.AsyncIOMotorClient
    motor_mod.AsyncIOMotorClient = lambda *a, **k: fake
    csv_path = tmp_path / "pw.csv"
    try:
        spec = importlib.util.spec_from_file_location(
            "reset_passwords_under_test", BACKEND_DIR / "reset_passwords.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        argv = sys.argv
        sys.argv = ["reset_passwords.py", "--out", str(csv_path)]
        try:
            asyncio.run(mod.main())
        finally:
            sys.argv = argv
    finally:
        motor_mod.AsyncIOMotorClient = original
        if previous_db_name is None:
            os.environ.pop("DB_NAME", None)
        else:
            os.environ["DB_NAME"] = previous_db_name

    assert csv_path.exists(), "the credential CSV was not written"

    async def read_all():
        return [u async for u in fake["bizcore_reset_test"].users.find({})]

    users = asyncio.run(read_all())
    assert len(users) == 2
    # the username must be backfilled from the email when it is missing
    bob = next(u for u in users if u["email"] == "bob@b.ng")
    assert bob.get("username") == "bob", bob

    # every stored hash must verify against the password in the CSV
    import csv as _csv
    with csv_path.open() as fh:
        rows = list(_csv.DictReader(fh))
    assert len(rows) == 2
    for row in rows:
        doc = next(u for u in users if u["user_id"] == row["user_id"])
        assert doc["password_hash"].startswith("pbkdf2_sha256$200000$"), doc
        assert verify_password(row["password"], doc["password_hash"]) is True, \
            "the CSV password does not verify against the stored hash"


def test_password_hashing_is_shared_not_duplicated():
    """The hashing routine must live in exactly one place.

    It used to be copy-pasted into server.py, reset_passwords.py and
    scripts/reset_passwords.py — a change in one copy silently produced
    passwords that the login endpoint could not verify.
    """
    import passwords as shared

    assert shared.hash_password("TestPass123").startswith("pbkdf2_sha256$200000$")
    assert shared.verify_password("TestPass123",
                                  shared.hash_password("TestPass123")) is True
    assert shared.verify_password("wrong",
                                  shared.hash_password("TestPass123")) is False

    for script in ("server.py", "reset_passwords.py", "scripts/reset_passwords.py"):
        src = (BACKEND_DIR / script).read_text()
        assert "def hash_password" not in src, \
            f"{script} still defines its own hash_password — import it from passwords.py"
        assert "_PBKDF2_ITERATIONS = 200_000" not in src, \
            f"{script} still hard-codes the iteration count"
