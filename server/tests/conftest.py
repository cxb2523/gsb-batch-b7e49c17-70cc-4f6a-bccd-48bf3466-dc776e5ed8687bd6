import os
import tempfile

# Redirect the application's database to a throwaway file BEFORE
# server.database / server.main are imported, so importing the app neither
# touches the real prisma/tradelab.db nor requires any external service.
_TEST_DB_DIR = tempfile.mkdtemp(prefix="tradelab-test-")
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_TEST_DB_DIR, "test.db")

# Ensure the Gemini client is never configured during tests.
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("NEXT_PUBLIC_GEMINI_API_KEY", None)
