import os
import logging

logger = logging.getLogger(__name__)


class GitHandler:
    def __init__(self, repo_path="."):
        self.repo_path = os.path.abspath(repo_path)
        self.repo = None
        self._init_repo()

    def _init_repo(self):
        try:
            import git
            self.repo = git.Repo(self.repo_path)
        except ImportError:
            logger.info("GitPython not available. Git tracking disabled.")
        except Exception:
            try:
                import git
                self.repo = git.Repo.init(self.repo_path)
                logger.info(f"Initialized new Git repository at {self.repo_path}")
            except Exception as e:
                logger.warning(f"Could not initialize Git repo: {e}")

    def commit_and_push(self, file_paths, message):
        if not self.repo:
            return False

        if not isinstance(file_paths, list):
            file_paths = [file_paths]

        try:
            self.repo.index.add(file_paths)
            self.repo.index.commit(message)
            logger.info(f"Committed: {message}")

            if self.repo.remotes:
                origin = self.repo.remote(name='origin')
                origin.push()
                logger.info("Pushed to remote.")
            return True
        except Exception as e:
            logger.warning(f"Git operation skipped: {e}")
            return False

    def get_log(self, limit=10):
        if not self.repo:
            return []
        try:
            return list(self.repo.iter_commits(max_count=limit))
        except Exception:
            return []
