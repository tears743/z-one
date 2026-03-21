#!/bin/bash
#
# InstantMesh macOS (Apple Silicon) Runner Script
# =================================================
# 
# This script sets up the environment and runs InstantMesh
# with proper MPS (Metal Performance Shaders) configuration.
#
# Usage:
#   ./run_macos.sh <mode> [options]
#
# Modes:
#   inference   - Run single image inference (default)
#   app         - Launch Gradio web UI
#   test        - Run MPS validation tests
#   help        - Show this help message
#
# Examples:
#   ./run_macos.sh inference --input image.jpg --output output/
#   ./run_macos.sh app
#   ./run_macos.sh test
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Virtual environment
VENV_PATH="$SCRIPT_DIR/venv"

# Check if virtual environment exists
if [ ! -d "$VENV_PATH" ]; then
    echo -e "${RED}Error: Virtual environment not found at $VENV_PATH${NC}"
    echo "Please run setup first or ensure dependencies are installed."
    exit 1
fi

# Activate virtual environment
echo -e "${BLUE}Activating virtual environment...${NC}"
source "$VENV_PATH/bin/activate"

# Set MPS environment variables for optimal performance
export PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.8  # Use up to 80% of available memory
export PYTORCH_ENABLE_MPS_FALLBACK=1         # Allow fallback to CPU for unsupported ops

# Verify Python and PyTorch
PYTHON_VERSION=$(python --version 2>&1)
MPS_AVAILABLE=$(python -c "import torch; print(torch.backends.mps.is_available())" 2>/dev/null || echo "False")

echo -e "${GREEN}✓ Python: $PYTHON_VERSION${NC}"
echo -e "${GREEN}✓ MPS Backend: $MPS_AVAILABLE${NC}"

if [ "$MPS_AVAILABLE" != "True" ]; then
    echo -e "${YELLOW}⚠ Warning: MPS not available. Falling back to CPU.${NC}"
fi

# Parse command
MODE="${1:-inference}"
shift || true  # Remove first argument, handle empty case

case "$MODE" in
    inference|run)
        echo -e "${BLUE}Running InstantMesh inference...${NC}"
        echo -e "${YELLOW}Note: Texture mapping is disabled on macOS. Vertex colors only.${NC}"
        
        # Default arguments
        DEFAULT_ARGS="--config configs/instant-mesh-large.yaml --isosurface_threshold 27"
        
        # Check if run.py exists
        if [ ! -f "$SCRIPT_DIR/instantmesh-research/run.py" ]; then
            echo -e "${RED}Error: run.py not found in instantmesh-research/${NC}"
            exit 1
        fi
        
        cd "$SCRIPT_DIR/instantmesh-research"
        python run.py $DEFAULT_ARGS "$@"
        ;;
        
    app|webui|gradio)
        echo -e "${BLUE}Launching Gradio web UI...${NC}"
        echo -e "${YELLOW}Note: Texture mapping is disabled on macOS. Vertex colors only.${NC}"
        
        if [ ! -f "$SCRIPT_DIR/instantmesh-research/app.py" ]; then
            echo -e "${RED}Error: app.py not found in instantmesh-research/${NC}"
            exit 1
        fi
        
        cd "$SCRIPT_DIR/instantmesh-research"
        python app.py "$@"
        ;;
        
    test|validate)
        echo -e "${BLUE}Running MPS validation tests...${NC}"
        
        if [ -f "$SCRIPT_DIR/test_mps.py" ]; then
            python "$SCRIPT_DIR/test_mps.py"
        else
            echo -e "${YELLOW}test_mps.py not found, running basic import test...${NC}"
            python -c "
import torch
import sys

print('Testing PyTorch MPS...')
print(f'PyTorch version: {torch.__version__}')
print(f'MPS available: {torch.backends.mps.is_available()}')
print(f'MPS built: {torch.backends.mps.is_built()}')

if torch.backends.mps.is_available():
    device = torch.device('mps')
    x = torch.rand(100, 100).to(device)
    y = x @ x.T
    print(f'Test tensor device: {y.device}')
    print('✓ MPS test passed!')
else:
    print('✗ MPS not available')
    sys.exit(1)
"
        fi
        ;;
        
    help|--help|-h)
        cat << 'EOF'
InstantMesh macOS Runner Script
===============================

Usage: ./run_macos.sh <mode> [options]

Modes:
  inference    Run single image inference (default)
               Example: ./run_macos.sh inference --input image.jpg --output ./output/
  
  app          Launch Gradio web UI
               Example: ./run_macos.sh app
  
  test         Run MPS validation tests
               Example: ./run_macos.sh test
  
  help         Show this help message

Environment Variables:
  PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.8   # Memory limit (default: 0.8)
  PYTORCH_ENABLE_MPS_FALLBACK=1          # CPU fallback for unsupported ops

Important Notes:
  - Texture mapping is DISABLED on macOS (nvdiffrast not available)
  - Only vertex color export is supported
  - Performance is ~2.5-3x slower than NVIDIA GPUs
  - Ensure model weights are downloaded before first run

For more information, see DEPLOYMENT_STATUS.md
EOF
        ;;
        
    *)
        echo -e "${RED}Unknown mode: $MODE${NC}"
        echo "Run './run_macos.sh help' for usage information."
        exit 1
        ;;
esac

echo -e "${GREEN}Done!${NC}"
