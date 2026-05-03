# Open SWE GitHub-Only Deployment Guide

This document provides precise, step-by-step instructions to set up the LangChain Open SWE agent using a 100% GitHub-native architecture (via GitHub Actions). No local machine or external self-hosted server is required. 

GitHub Copilot can read this document and execute the automated code steps directly.

## Status Tracker
- [ ] **Step 1:** Configure Repository Permissions (Manual)
- [ ] **Step 2:** Configure Repository Secrets (Manual)
- [ ] **Step 3:** Create the GitHub Actions Workflow File (Copilot)
- [ ] **Step 4:** Trigger and Verify the Agent (Manual)

---

## Step 1: Configure Repository Permissions (Manual)
*Note: Copilot cannot modify repository settings. The repository admin must do this manually.*

1. Navigate to your GitHub repository in your browser.
2. Go to **Settings** > **Actions** > **General**.
3. Scroll down to the **Workflow permissions** section.
4. Select **Read and write permissions**.
5. Check the box labeled **Allow GitHub Actions to create and approve pull requests**.
6. Click **Save**.

## Step 2: Configure Repository Secrets (Manual)
*Note: Copilot cannot create repository secrets.*

1. In your repository, go to **Settings** > **Secrets and variables** > **Actions**.
2. Click **New repository secret**.
3. Name: `DEEPSEEK_API_KEY`
4. Secret: Paste your DeepSeek V4 API key here.
5. Click **Add secret**.
*(You do not need to add a `GITHUB_TOKEN`. GitHub automatically provisions a temporary token during the workflow run).*

## Step 3: Create the GitHub Actions Workflow File (Copilot)
**Instruction for Copilot:** Create the following directories and file in the root of the project, exactly as written below.

**Filepath:** `.github/workflows/open-swe-agent.yml`

```yaml
name: Open SWE Agent

on:
  issue_comment:
    types: [created]

jobs:
  run-open-swe:
    name: Execute Open SWE
    # Trigger only if the comment contains '@openswe' and the event is on an Issue (not a PR)
    if: ${{ !github.event.issue.pull_request && contains(github.event.comment.body, '@openswe') }}
    runs-on: ubuntu-latest
    
    steps:
      - name: Acknowledge Request
        uses: actions/github-script@v7
        with:
          script: |
            // Adds an 👀 reaction to let the user know the agent has picked up the task
            github.rest.reactions.createForIssueComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              comment_id: context.payload.comment.id,
              content: 'eyes'
            })

      - name: Checkout Open SWE Repository
        uses: actions/checkout@v4
        with:
          repository: langchain-ai/open-swe
          path: open-swe

      - name: Setup Python 3.11
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'

      - name: Install Open SWE Dependencies
        working-directory: ./open-swe
        run: |
          pip install -r requirements.txt

      - name: Run Open SWE Agent
        working-directory: ./open-swe
        env:
          # DeepSeek configuration leveraging OpenAI compatibility
          OPENAI_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
          OPENAI_API_BASE: "https://api.deepseek.com/v1"
          MODEL_NAME: "deepseek-chat"
          
          # GitHub context
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          
          # Sandbox config (Leveraging the Docker engine pre-installed on the ubuntu-latest runner)
          SANDBOX_PROVIDER: "docker"
          WORKSPACE_MOUNT_PATH: "/tmp/workspace"
        run: |
          python -m open_swe.cli \
            --repo ${{ github.repository }} \
            --issue ${{ github.event.issue.number }}

## Step 4: Trigger and Verify the Agent (Manual)

Once Copilot has committed the workflow file from Step 3:

1. Open a new Issue in your GitHub repository detailing a bug or a feature.
2. Add a comment on that issue containing the tag: `@openswe please implement this`.
3. Go to the **Actions** tab in your repository. You should see the workflow spin up.
4. The bot will acknowledge the comment with an 👀 reaction, clone the repository in the GitHub Action runner, use DeepSeek to resolve the issue inside a Docker container, and finally open a Pull Request.
