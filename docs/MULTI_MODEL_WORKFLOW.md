# Multi-Model AI Development with Cursor Worktrees

A practical guide for running multiple AI models in parallel using Git worktrees.

---

## 🎯 Quick Start

### Your Current Setup

```
Main Repo: /Users/moz/scrapper-suite (main)
    │
Worktrees: /Users/moz/.cursor/worktrees/scrapper-suite/
    ├── atx  → (current) 
    ├── caw  → worktree-setup branch
    ├── cbp  → code-analysis-report
    ├── gki  → code-analysis
    ├── gux  → detached (⚠️ needs branch)
    └── qco  → code-analysis-v2
```

### Recommended Cleanup & Reorganization

```bash
# From main repo
cd /Users/moz/scrapper-suite

# 1. Remove detached/unused worktrees
git worktree remove ~/.cursor/worktrees/scrapper-suite/atx --force
git worktree remove ~/.cursor/worktrees/scrapper-suite/gux --force

# 2. Create model-focused worktrees
git worktree add ~/.cursor/worktrees/scrapper-suite/opus -b dev/opus-main
git worktree add ~/.cursor/worktrees/scrapper-suite/sonnet -b dev/sonnet-main
git worktree add ~/.cursor/worktrees/scrapper-suite/gemini -b dev/gemini-main

# 3. Create task-focused worktrees (optional)
git worktree add ~/.cursor/worktrees/scrapper-suite/testing -b dev/testing
git worktree add ~/.cursor/worktrees/scrapper-suite/review -b dev/review
```

---

## 🧠 Workflow Strategies

### Strategy 1: Model Competition (Same Task)
**Use case**: Get different perspectives on the same problem

```
┌─────────────────────────────────────────────────────────────┐
│  TASK: "Implement font matching system"                     │
├──────────────────┬──────────────────┬──────────────────────┤
│   opus/          │   sonnet/        │   gemini/            │
│   feat/fonts-v1  │   feat/fonts-v2  │   feat/fonts-v3      │
│                  │                  │                      │
│   Complex algo   │   Simple impl    │   Alternative        │
│   with caching   │   with fallback  │   approach           │
└──────────────────┴──────────────────┴──────────────────────┘
                            │
                            ▼
              Human reviews, picks best, merges
```

**How to coordinate**:
1. Create a `TASK_BRIEF.md` in main repo
2. Each model reads it before starting
3. Use branch prefixes: `feat/fonts-opus`, `feat/fonts-sonnet`
4. Compare outputs, cherry-pick best parts

---

### Strategy 2: Assembly Line (Specialized Roles)
**Use case**: Each model does what it's best at

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│     opus/      │     │    sonnet/     │     │   o1-review/   │
│   "Architect"  │ ──▶ │  "Implementer" │ ──▶ │   "Reviewer"   │
│                │     │                │     │                │
│  - Design API  │     │  - Write code  │     │  - Find bugs   │
│  - Create plan │     │  - Add tests   │     │  - Optimize    │
└────────────────┘     └────────────────┘     └────────────────┘
```

**Suggested model assignments**:
| Role | Best Models | Why |
|------|-------------|-----|
| Architecture/Planning | Opus, o1 | Deep reasoning |
| Implementation | Sonnet, GPT-4 | Balance of speed/quality |
| Testing | Sonnet, Gemini | Good at patterns |
| Review/Security | o1, Opus | Careful analysis |
| Documentation | Sonnet, Gemini | Fast, clear writing |

---

### Strategy 3: Parallel Features (Independent Work)
**Use case**: Build multiple features simultaneously

```
┌─────────────────────────────────────────────────────────────┐
│                     main branch                             │
├──────────────────┬──────────────────┬──────────────────────┤
│   opus/          │   sonnet/        │   gemini/            │
│   feat/gradients │   feat/tests     │   feat/extension-v2  │
│                  │                  │                      │
│   Gradient       │   Test suite     │   Chrome ext         │
│   parsing        │   for serializer │   improvements       │
└──────────────────┴──────────────────┴──────────────────────┘
```

---

## 📁 Recommended Worktree Structure

### For This Project (Scrapper Suite)

```bash
# Model-dedicated worktrees
~/.cursor/worktrees/scrapper-suite/
├── opus/          # Complex features, architecture decisions
├── sonnet/        # Day-to-day implementation, tests
├── gemini/        # Experiments, alternative approaches
│
# Task-dedicated (shared between models)
├── testing/       # Test coverage improvements
├── review/        # Code review and refactoring
└── docs/          # Documentation updates
```

---

## 🔧 Setup Scripts

### Create Model Worktrees (Run Once)

```bash
#!/bin/bash
# Save as: setup-worktrees.sh

MAIN_REPO="/Users/moz/scrapper-suite"
WORKTREES="/Users/moz/.cursor/worktrees/scrapper-suite"

cd "$MAIN_REPO"

# Create model worktrees
for model in opus sonnet gemini; do
    if [ ! -d "$WORKTREES/$model" ]; then
        git worktree add "$WORKTREES/$model" -b "dev/$model-main"
        echo "✅ Created $model worktree"
    fi
done

# Setup each worktree
for wt in "$WORKTREES"/*; do
    if [ -d "$wt/scrapper-suite" ]; then
        echo "📦 Installing deps in $(basename $wt)..."
        (cd "$wt/scrapper-suite" && npm install --silent)
    fi
done

echo "🎉 All worktrees ready!"
```

### Switch Cursor to a Worktree

1. **File → Open Folder**
2. Navigate to `~/.cursor/worktrees/scrapper-suite/opus` (or other worktree)
3. Cursor opens a new window for that worktree

Or use keyboard shortcut: `Cmd+K Cmd+O` → select worktree folder

---

## 💬 Coordinating Between Models

### AGENTS.md Template

Add this section to help models understand the multi-model setup:

```markdown
## Multi-Model Coordination

This repo uses parallel AI development with Git worktrees.

**Active Worktrees:**
- `opus/` → Complex features, architecture (Claude Opus)
- `sonnet/` → Implementation, tests (Claude Sonnet)
- `gemini/` → Experiments (Gemini)

**Your Responsibilities (check your worktree name):**
- Read existing code before making changes
- Use commit prefix: `[opus]`, `[sonnet]`, `[gemini]`
- Document decisions in commit messages
- Don't duplicate work done in other worktrees

**Before Starting:**
1. Run `git fetch origin` to see latest changes
2. Check other branches: `git branch -a`
3. Read recent commits: `git log --oneline -10`
```

### Commit Message Format

```
[model] type: description

# Examples:
[opus] feat: add gradient angle parsing
[sonnet] test: add serializer unit tests
[gemini] refactor: simplify image proxy
[opus] fix: correct shadow spread calculation
```

---

## 🔄 Syncing Work Between Worktrees

### Pull Latest from Another Worktree

```bash
# In your worktree (e.g., sonnet/)
git fetch origin
git log origin/dev/opus-main --oneline -5  # See Opus's work

# Cherry-pick specific commit
git cherry-pick <commit-hash>

# Or merge entire branch
git merge origin/dev/opus-main
```

### Share to Main

```bash
# Push your branch
git push origin dev/sonnet-main

# Create PR (from any worktree)
gh pr create --base main --head dev/sonnet-main
```

---

## ⚠️ Common Pitfalls

### 1. Detached HEAD
**Problem**: Worktree not on a branch
```bash
# Fix: Create a branch immediately
git checkout -b dev/my-feature
```

### 2. Branch Already Checked Out
**Problem**: Can't use same branch in two worktrees
```bash
# Fix: Use different branch names
# Each worktree = unique branch
```

### 3. Merge Conflicts Across Worktrees
**Prevention**: 
- Assign different files/features to each model
- Communicate via commit messages
- Merge frequently to main

### 4. Forgetting Which Worktree You're In
**Fix**: Check your terminal prompt or run:
```bash
git worktree list | grep $(pwd)
```

---

## 📊 Example Session: Parallel Development

```
TASK: Improve Website-to-Figma quality

Session Timeline:
─────────────────────────────────────────────────────
09:00  Create task branches in each worktree
       opus/   → git checkout -b feat/gradient-parsing
       sonnet/ → git checkout -b feat/font-matching
       gemini/ → git checkout -b feat/parallel-images
       
09:15  Each model works independently
       - Opus: Complex gradient angle math
       - Sonnet: Font similarity algorithm
       - Gemini: Image batching system
       
11:00  Checkpoint: Commit work, push to origin
       
11:15  Cross-review
       - Opus reviews Sonnet's font work
       - Sonnet reviews Gemini's image work
       
12:00  Merge best implementations to main
       Human picks: Opus gradients + Sonnet fonts
       (Gemini's approach saved for later)
─────────────────────────────────────────────────────
```

---

## Quick Reference

| Task | Command |
|------|---------|
| List worktrees | `git worktree list` |
| Create new | `git worktree add PATH -b BRANCH` |
| Remove | `git worktree remove PATH` |
| Clean stale | `git worktree prune` |
| Current branch | `git branch --show-current` |
| Fetch all | `git fetch --all` |
| See other work | `git log origin/dev/opus-main --oneline` |

---

## Your Scrapper Suite Recommendation

For your project, I suggest this setup:

| Worktree | Branch | Purpose |
|----------|--------|---------|
| `opus/` | `dev/opus-main` | Architecture, complex features |
| `sonnet/` | `dev/sonnet-main` | Implementation, tests, docs |
| `gemini/` | `dev/gemini-main` | Experiments, alternatives |

**Immediate tasks to assign**:
- **Opus**: Fix gradient parsing, font matching system
- **Sonnet**: Add test suite for dom-serializer, fix TypeScript issues
- **Gemini**: Chrome Extension v2, parallel image loading

---

*Guide created December 2025*
