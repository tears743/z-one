# InstantMesh Image-to-3D Skill

## Overview
Quick reference for using InstantMesh image-to-3D conversion on deployed systems.

## Local macOS Deployment (Apple Silicon)

### Quick Start
```bash
cd /Users/tj/workspace/z-one
source venv/bin/activate
cd instantmesh-research
```

### Run Inference
```bash
# Single image
python run.py --config configs/instant-mesh-large.yaml --input /path/to/image.jpg --output ./output/

# With options
python run.py \
  --config configs/instant-mesh-large.yaml \
  --input image.jpg \
  --output ./output/ \
  --isosurface_threshold 27 \
  --no_remove_bg
```

### Launch Web UI
```bash
python app.py
# Access at http://localhost:7860
```

### Using Runner Script
```bash
cd /Users/tj/workspace/z-one
./run_macos.sh inference --input image.jpg --output ./output/
./run_macos.sh app
./run_macos.sh test
```

## Remote Windows Deployment (100.69.228.96)

### Connection (requires manual SSH setup)
```bash
ssh Admin@100.69.228.96
```

### After SSH Connected
```powershell
# Activate environment
C:\InstantMesh\venv\Scripts\Activate.ps1
cd C:\InstantMesh\InstantMesh

# Run inference (adjust for CPU/GPU)
python run.py --config configs/instant-mesh-large.yaml --input image.jpg --output .\output\
```

## Environment Variables

### macOS MPS Optimization
```bash
export PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.8
export PYTORCH_ENABLE_MPS_FALLBACK=1
```

### Windows CUDA (if available)
```powershell
$env:CUDA_VISIBLE_DEVICES = "0"
```

## Output Files

| File | Description |
|------|-------------|
| `mesh.obj` | Wavefront OBJ with vertex colors |
| `mesh.glb` | Binary glTF (recommended for web) |
| `video.mp4` | 360° rotation preview |
| `image.png` | Multi-view render preview |

## Limitations by Platform

| Feature | macOS M2 Pro | Windows CUDA | Windows CPU |
|---------|--------------|--------------|-------------|
| Multi-view Gen | ✅ | ✅ | ✅ (slow) |
| Mesh Extraction | ✅ | ✅ | ✅ (slow) |
| Vertex Colors | ✅ | ✅ | ✅ |
| Texture Mapping | ❌ | ✅ | ❌ |
| Performance | ~25-35s | ~10s | ~60-120s |

## Troubleshooting

### macOS
- **MPS out of memory**: Reduce `PYTORCH_MPS_HIGH_WATERMARK_RATIO` to 0.6
- **Import errors**: Ensure venv is activated

### Windows
- **CUDA not found**: Install NVIDIA drivers and CUDA toolkit
- **SSH failed**: Check `C:\Users\Admin\.ssh\authorized_keys` permissions

## Model Weights

Auto-downloaded from HuggingFace on first run:
- `sudo-ai/zero123plus-v1.2` - Multi-view diffusion
- `TencentARC/InstantMesh` - Reconstruction model

## References

- GitHub: https://github.com/TencentARC/InstantMesh
- Paper: https://arxiv.org/abs/2404.07191
- HuggingFace: https://huggingface.co/TencentARC/InstantMesh

---
*Deployment Date: 2026-03-18*
*Local Status: ✅ Operational (macOS M2 Pro)*
*Remote Status: ❌ Pending SSH Configuration*
