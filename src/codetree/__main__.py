import argparse
import os
from .server import run

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".", help="Path to repo root (default: current directory)")
    args = parser.parse_args()
    run(os.path.abspath(args.root))

if __name__ == "__main__":
    main()
