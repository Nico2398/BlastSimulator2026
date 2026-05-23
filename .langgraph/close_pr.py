import json, os, urllib.request
from dotenv import load_dotenv
load_dotenv()

token = os.environ["GITHUB_TOKEN"]
url = "https://api.github.com/repos/Nico2398/BlastSimulator2026/pulls/163"
data = json.dumps({"state": "closed"}).encode()
req = urllib.request.Request(url, data=data, method="PATCH")
req.add_header("Authorization", f"Bearer {token}")
req.add_header("Accept", "application/vnd.github.v3+json")
req.add_header("Content-Type", "application/json")
resp = urllib.request.urlopen(req)
d = json.loads(resp.read())
print(f"PR #{d['number']} closed: {d['html_url']}")
