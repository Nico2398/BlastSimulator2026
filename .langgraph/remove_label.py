import os, urllib.request
from urllib.error import HTTPError
from dotenv import load_dotenv
load_dotenv()

token = os.environ["GITHUB_TOKEN"]

# Remove in-review label from issue #118
url = "https://api.github.com/repos/Nico2398/BlastSimulator2026/issues/118/labels/in-review"
req = urllib.request.Request(url, method="DELETE")
req.add_header("Authorization", f"Bearer {token}")
try:
    resp = urllib.request.urlopen(req)
    print(f"Removed in-review label (status {resp.status})")
except HTTPError as e:
    print(f"Error: {e.code} {e.reason}")
