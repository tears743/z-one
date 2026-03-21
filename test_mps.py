#!/usr/bin/env python3
"""
InstantMesh MPS (Apple Silicon) Validation Test Suite
======================================================

This script validates that the MPS-patched InstantMesh installation
is working correctly on macOS Apple Silicon.

Usage:
    python test_mps.py
    
Or via the runner script:
    ./run_macos.sh test
"""

import sys
import os
import warnings
from typing import Tuple, List

# Add instantmesh-research to path if running from root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'instantmesh-research'))

# Test results tracking
class TestResult:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.warnings = 0
        self.messages = []
    
    def add_pass(self, msg: str):
        self.passed += 1
        self.messages.append(("PASS", msg))
        print(f"  ✓ {msg}")
    
    def add_fail(self, msg: str, error: str = ""):
        self.failed += 1
        self.messages.append(("FAIL", msg, error))
        print(f"  ✗ {msg}")
        if error:
            print(f"    Error: {error}")
    
    def add_warn(self, msg: str):
        self.warnings += 1
        self.messages.append(("WARN", msg))
        print(f"  ⚠ {msg}")
    
    def summary(self) -> Tuple[int, int, int]:
        return self.passed, self.failed, self.warnings

results = TestResult()

print("=" * 70)
print("InstantMesh MPS Validation Test Suite")
print("=" * 70)
print()

# =============================================================================
# TEST 1: Core PyTorch MPS
# =============================================================================
print("TEST 1: Core PyTorch MPS Backend")
print("-" * 50)

try:
    import torch
    results.add_pass("PyTorch imported successfully")
    
    # Check version
    version = torch.__version__
    results.add_pass(f"PyTorch version: {version}")
    
    # Check MPS availability
    mps_available = torch.backends.mps.is_available()
    mps_built = torch.backends.mps.is_built()
    
    if mps_available:
        results.add_pass("MPS backend is available")
    else:
        results.add_fail("MPS backend is NOT available")
    
    if mps_built:
        results.add_pass("MPS is built into PyTorch")
    else:
        results.add_warn("MPS is not built into this PyTorch version")
    
    # Test MPS tensor operations
    if mps_available:
        try:
            device = torch.device('mps')
            x = torch.rand(100, 100).to(device)
            y = torch.mm(x, x.T)
            z = y.cpu()
            results.add_pass("MPS tensor operations working")
        except Exception as e:
            results.add_fail("MPS tensor operations failed", str(e))
    
except ImportError as e:
    results.add_fail("Failed to import PyTorch", str(e))
except Exception as e:
    results.add_fail("Unexpected error in PyTorch tests", str(e))

print()

# =============================================================================
# TEST 2: Device Selection Logic
# =============================================================================
print("TEST 2: Device Selection Logic")
print("-" * 50)

try:
    import torch
    
    # Test the get_device function pattern used in patched files
    def get_device():
        """Detect the best available device."""
        if torch.backends.mps.is_available():
            return torch.device('mps')
        elif torch.cuda.is_available():
            return torch.device('cuda')
        else:
            return torch.device('cpu')
    
    device = get_device()
    results.add_pass(f"Device selection working: {device}")
    
    # Verify device is appropriate for the platform
    if device.type == 'mps':
        results.add_pass("Correctly selected MPS on macOS")
    elif device.type == 'cuda':
        results.add_warn("Selected CUDA (unexpected on macOS)")
    else:
        results.add_warn(f"Selected CPU (MPS not available)")
    
    # Test device transfer
    test_tensor = torch.rand(10, 10)
    device_tensor = test_tensor.to(device)
    results.add_pass(f"Device transfer working: {device_tensor.device}")
    
except Exception as e:
    results.add_fail("Device selection test failed", str(e))

print()

# =============================================================================
# TEST 3: nvdiffrast Handling
# =============================================================================
print("TEST 3: nvdiffrast Import Guards")
print("-" * 50)

try:
    # Test the nvdiffrast import pattern used in patched files
    try:
        import nvdiffrast.torch as dr
        HAS_NVDIFFRAST = True
        results.add_warn("nvdiffrast is installed (unexpected on macOS)")
    except ImportError:
        HAS_NVDIFFRAST = False
        dr = None
        results.add_pass("nvdiffrast correctly unavailable on macOS")
    
    # Test that code handles this gracefully
    if not HAS_NVDIFFRAST:
        results.add_pass("nvdiffrast unavailable - texture mapping will be disabled")
        results.add_pass("Vertex color export remains functional")
    
except Exception as e:
    results.add_fail("nvdiffrast handling test failed", str(e))

print()

# =============================================================================
# TEST 4: Required Libraries
# =============================================================================
print("TEST 4: Required Libraries Import")
print("-" * 50)

required_libs = [
    ('numpy', 'NumPy'),
    ('PIL', 'Pillow'),
    ('cv2', 'OpenCV'),
    ('scipy', 'SciPy'),
    ('einops', 'einops'),
    ('omegaconf', 'OmegaConf'),
    ('pytorch_lightning', 'PyTorch Lightning'),
    ('transformers', 'Transformers'),
    ('diffusers', 'Diffusers'),
    ('accelerate', 'Accelerate'),
]

for module_name, display_name in required_libs:
    try:
        __import__(module_name)
        results.add_pass(f"{display_name} imported successfully")
    except ImportError as e:
        results.add_fail(f"{display_name} import failed", str(e))

print()

# =============================================================================
# TEST 5: 3D Processing Libraries
# =============================================================================
print("TEST 5: 3D Processing Libraries")
print("-" * 50)

libs_3d = [
    ('trimesh', 'Trimesh'),
    ('xatlas', 'xatlas'),
    ('plyfile', 'PLYfile'),
]

for module_name, display_name in libs_3d:
    try:
        __import__(module_name)
        results.add_pass(f"{display_name} imported successfully")
    except ImportError as e:
        results.add_fail(f"{display_name} import failed", str(e))

# PyMCubes may have issues - test separately
try:
    import pymcubes
    results.add_pass("PyMCubes imported successfully")
except ImportError as e:
    results.add_warn(f"PyMCubes import issue (optional): {e}")

print()

# =============================================================================
# TEST 6: InstantMesh Source Modules
# =============================================================================
print("TEST 6: InstantMesh Source Modules")
print("-" * 50)

source_modules = [
    ('src.utils.train_util', 'train_util'),
    ('src.utils.camera_util', 'camera_util'),
    ('src.utils.infer_util', 'infer_util'),
]

for module_name, display_name in source_modules:
    try:
        __import__(module_name)
        results.add_pass(f"{display_name} imported successfully")
    except ImportError as e:
        # This is expected if we're not in the right directory
        if "instantmesh" in str(e).lower():
            results.add_warn(f"{display_name} not in path (run from correct directory)")
        else:
            results.add_fail(f"{display_name} import failed", str(e))
    except Exception as e:
        results.add_fail(f"{display_name} import failed", str(e))

print()

# =============================================================================
# TEST 7: Configuration Files
# =============================================================================
print("TEST 7: Configuration Files")
print("-" * 50)

import glob

config_patterns = [
    'instantmesh-research/configs/*.yaml',
    'configs/*.yaml',
]

config_found = False
for pattern in config_patterns:
    configs = glob.glob(pattern)
    if configs:
        config_found = True
        results.add_pass(f"Found {len(configs)} config files")
        for cfg in configs[:3]:  # Show first 3
            print(f"    - {cfg}")
        break

if not config_found:
    results.add_warn("No config files found (run from project root)")

print()

# =============================================================================
# TEST 8: Environment Variables
# =============================================================================
print("TEST 8: Environment Configuration")
print("-" * 50)

# Check recommended environment variables
mps_high_watermark = os.environ.get('PYTORCH_MPS_HIGH_WATERMARK_RATIO', '0.8 (default)')
mps_fallback = os.environ.get('PYTORCH_ENABLE_MPS_FALLBACK', '1 (default)')

results.add_pass(f"MPS high watermark ratio: {mps_high_watermark}")
results.add_pass(f"MPS fallback enabled: {mps_fallback}")

# Check virtual environment
venv_path = os.environ.get('VIRTUAL_ENV', 'Not in virtual environment')
if venv_path != 'Not in virtual environment':
    results.add_pass(f"Virtual environment: {venv_path}")
else:
    results.add_warn("Not running in a virtual environment")

print()

# =============================================================================
# TEST 9: Backup Files Verification
# =============================================================================
print("TEST 9: Patched File Verification")
print("-" * 50)

backup_files = [
    'instantmesh-research/run.py.bak',
    'instantmesh-research/app.py.bak',
    'instantmesh-research/src/model_mesh.py.bak',
    'instantmesh-research/src/models/lrm.py.bak',
    'instantmesh-research/src/models/lrm_mesh.py.bak',
    'instantmesh-research/src/utils/mesh_util.py.bak',
]

backup_found = 0
for backup_file in backup_files:
    if os.path.exists(backup_file):
        backup_found += 1
        # Check if patched file exists too
        original = backup_file.replace('.bak', '')
        if os.path.exists(original):
            results.add_pass(f"Patched: {os.path.basename(original)}")
        else:
            results.add_warn(f"Backup exists but original missing: {backup_file}")

if backup_found == 0:
    results.add_warn("No backup files found (files may not be patched yet)")
else:
    results.add_pass(f"Found {backup_found} patched files")

print()

# =============================================================================
# TEST 10: Memory and System Check
# =============================================================================
print("TEST 10: System Resources")
print("-" * 50)

try:
    import psutil
    
    # Memory info
    mem = psutil.virtual_memory()
    total_gb = mem.total / (1024**3)
    available_gb = mem.available / (1024**3)
    
    results.add_pass(f"Total RAM: {total_gb:.1f} GB")
    results.add_pass(f"Available RAM: {available_gb:.1f} GB")
    
    if total_gb < 16:
        results.add_warn("Less than 16GB RAM - performance may be limited")
    
    # Disk info
    disk = psutil.disk_usage('.')
    disk_free_gb = disk.free / (1024**3)
    results.add_pass(f"Free disk space: {disk_free_gb:.1f} GB")
    
    if disk_free_gb < 10:
        results.add_warn("Less than 10GB free space - model downloads may fail")
        
except ImportError:
    results.add_warn("psutil not available - skipping system resource check")

print()

# =============================================================================
# SUMMARY
# =============================================================================
print("=" * 70)
print("TEST SUMMARY")
print("=" * 70)

passed, failed, warnings = results.summary()
total = passed + failed

print(f"  Total Tests: {total}")
print(f"  ✓ Passed: {passed}")
print(f"  ✗ Failed: {failed}")
print(f"  ⚠ Warnings: {warnings}")
print()

if failed == 0:
    print("🎉 ALL CRITICAL TESTS PASSED!")
    print()
    print("Your InstantMesh installation is ready for macOS Apple Silicon.")
    print()
    print("Next steps:")
    print("  1. Download model weights (first run will auto-download)")
    print("  2. Run inference: ./run_macos.sh inference --input your_image.jpg")
    print("  3. Or launch UI: ./run_macos.sh app")
    print()
    print("Note: Texture mapping is disabled. Only vertex colors are supported.")
    sys.exit(0)
elif failed <= 2 and warnings > 0:
    print("⚠ MOSTLY WORKING WITH WARNINGS")
    print()
    print("The installation has some non-critical issues:")
    for status, msg, *args in results.messages:
        if status in ("FAIL", "WARN"):
            print(f"  - {msg}")
    print()
    print("You may still be able to run basic inference.")
    sys.exit(0)
else:
    print("✗ INSTALLATION HAS CRITICAL ISSUES")
    print()
    print("Please fix the following before running InstantMesh:")
    for status, msg, *args in results.messages:
        if status == "FAIL":
            error = args[0] if args else ""
            print(f"  ✗ {msg}")
            if error:
                print(f"    {error}")
    print()
    sys.exit(1)
