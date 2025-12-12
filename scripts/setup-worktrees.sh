#!/bin/bash
# ============================================================
# Worktree Setup Script for Multi-Model AI Development
# ============================================================

MAIN_REPO="/Users/moz/scrapper-suite"
WORKTREES_DIR="/Users/moz/.cursor/worktrees/scrapper-suite"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   Worktree Setup for Scrapper Suite${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

cd "$MAIN_REPO" || { echo -e "${RED}Error: Cannot access main repo${NC}"; exit 1; }

# Show current worktrees
echo -e "${YELLOW}Current worktrees:${NC}"
git worktree list
echo ""

# Function to create worktree
create_worktree() {
    local name=$1
    local branch=$2
    local purpose=$3
    
    if [ -d "$WORKTREES_DIR/$name" ]; then
        echo -e "${YELLOW}⏭️  $name already exists (skipping)${NC}"
    else
        echo -e "${BLUE}🔧 Creating $name worktree...${NC}"
        git worktree add "$WORKTREES_DIR/$name" -b "$branch" 2>/dev/null || \
        git worktree add "$WORKTREES_DIR/$name" "$branch" 2>/dev/null || \
        echo -e "${RED}   Failed to create $name${NC}"
        echo -e "${GREEN}   ✅ $name → $purpose${NC}"
    fi
}

# Prompt for action
echo -e "${YELLOW}What would you like to do?${NC}"
echo "  1) Create model-focused worktrees (opus, sonnet, gemini)"
echo "  2) Create task-focused worktrees (testing, review, docs)"
echo "  3) Clean up detached/old worktrees"
echo "  4) List all worktrees and exit"
echo "  5) Full setup (recommended)"
echo ""
read -p "Enter choice [1-5]: " choice

case $choice in
    1)
        echo -e "\n${BLUE}Creating model worktrees...${NC}\n"
        create_worktree "opus" "dev/opus-main" "Complex features, architecture"
        create_worktree "sonnet" "dev/sonnet-main" "Implementation, tests"
        create_worktree "gemini" "dev/gemini-main" "Experiments, alternatives"
        ;;
    2)
        echo -e "\n${BLUE}Creating task worktrees...${NC}\n"
        create_worktree "testing" "dev/testing" "Test coverage"
        create_worktree "review" "dev/review" "Code review"
        create_worktree "docs" "dev/docs" "Documentation"
        ;;
    3)
        echo -e "\n${YELLOW}Worktrees to potentially remove:${NC}"
        git worktree list | grep "detached\|HEAD"
        echo ""
        read -p "Remove all detached worktrees? [y/N]: " confirm
        if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
            for wt in $(git worktree list | grep "detached" | awk '{print $1}'); do
                echo -e "${RED}Removing $wt${NC}"
                git worktree remove --force "$wt"
            done
            git worktree prune
            echo -e "${GREEN}✅ Cleanup complete${NC}"
        fi
        ;;
    4)
        echo -e "\n${BLUE}All worktrees:${NC}"
        git worktree list
        ;;
    5)
        echo -e "\n${BLUE}Full setup in progress...${NC}\n"
        
        # Clean up detached
        echo -e "${YELLOW}Cleaning detached worktrees...${NC}"
        for wt in $(git worktree list | grep "detached" | awk '{print $1}'); do
            git worktree remove --force "$wt" 2>/dev/null
        done
        git worktree prune
        
        # Create model worktrees
        echo -e "\n${BLUE}Creating model worktrees...${NC}"
        create_worktree "opus" "dev/opus-main" "Complex features, architecture"
        create_worktree "sonnet" "dev/sonnet-main" "Implementation, tests"
        create_worktree "gemini" "dev/gemini-main" "Experiments, alternatives"
        
        # Install dependencies
        echo -e "\n${BLUE}Installing dependencies...${NC}"
        for model in opus sonnet gemini; do
            wt_path="$WORKTREES_DIR/$model"
            if [ -d "$wt_path/scrapper-suite" ]; then
                echo -e "  📦 ${model}/scrapper-suite..."
                (cd "$wt_path/scrapper-suite" && npm install --silent 2>/dev/null)
            fi
            if [ -d "$wt_path/clients/figma-plugin" ]; then
                echo -e "  📦 ${model}/figma-plugin..."
                (cd "$wt_path/clients/figma-plugin" && npm install --silent 2>/dev/null)
            fi
        done
        
        echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}   ✅ Setup Complete!${NC}"
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${BLUE}Final worktree list:${NC}"
git worktree list
echo ""
echo -e "${YELLOW}To open a worktree in Cursor:${NC}"
echo "  File → Open Folder → ~/.cursor/worktrees/scrapper-suite/opus"
echo ""
echo -e "${YELLOW}Or from terminal:${NC}"
echo "  cursor ~/.cursor/worktrees/scrapper-suite/opus"
