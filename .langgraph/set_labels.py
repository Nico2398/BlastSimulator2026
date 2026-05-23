import json, os, urllib.request
from urllib.error import HTTPError
from dotenv import load_dotenv
load_dotenv()

token = os.environ["GITHUB_TOKEN"]

# Remove done label from issue #118
url = "https://api.github.com/repos/Nico2398/BlastSimulator2026/issues/118/labels/done"
req = urllib.request.Request(url, method="DELETE")
req.add_header("Authorization", f"Bearer {token}")
try:
    resp = urllib.request.urlopen(req)
    print(f"Removed done label (status {resp.status})")
except HTTPError as e:
    print(f"Error removing done: {e.code} {e.reason}")

# Ensure ready label is present
url2 = "https://api.github.com/repos/Nico2398/BlastSimulator2026/issues/118/labels"
data = json.dumps({"labels": ["agent-task", "ready"]}).encode()
req2 = urllib.request.Request(url2, data=data, method="PUT")
req2.add_header("Authorization", f"Bearer {token}")
req2.add_header("Content-Type", "application/json")
try:
    resp2 = urllib.request.urlopen(req2)
    print(f"Set labels to agent-task, ready (status {resp2.status})")
except HTTPError as e:
    print(f"Error setting labels: {e.code} {e.reason}")
