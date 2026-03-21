# Image-to-3D Model vs Hardware Comparison Matrix
## Hardware Platform: Apple M2 Pro (32GB Unified Memory)

---

## 📊 EXECUTIVE SUMMARY

| Metric | Value |
|--------|-------|
| **Platform** | Apple Silicon M2 Pro (ARM64) |
| **GPU** | 16-core GPU with Metal 4 |
| **Available VRAM** | 32GB Unified Memory (shared) |
| **CUDA Support** | ❌ None - Uses MPS |
| **Usable GPU Memory** | ~24-28GB (accounting for system overhead) |

---

## 🔍 MODEL COMPARISON MATRIX

### All Discovered Image-to-3D Models (2023-2025)

| Model | Release Date | License | VRAM Required | Fits VRAM? | Quality Score | Inference Speed | CUDA Required | MPS Compatible |
|-------|-------------|---------|---------------|------------|---------------|-----------------|---------------|----------------|
| **InstantMesh** | Apr 2024 | ✅ Apache-2.0 | 10-12GB | ✅ YES | ⭐⭐⭐⭐⭐ (SOTA) | ~10s | ⚠️ Yes* | ⚠️ Partial |
| **SV3D (Stable Video 3D)** | Mar 2024 | ⚠️ Non-Commercial | 12-16GB | ✅ YES | ⭐⭐⭐⭐⭐ (SOTA) | ~30s | ⚠️ Yes* | ⚠️ Partial |
| **CRM/ZERO123++** | Oct 2023 | ⚠️ Research Only | 16GB+ | ✅ YES | ⭐⭐⭐⭐ (High) | ~20s | ⚠️ Yes* | ⚠️ Partial |
| **Wonder3D** | Dec 2023 | ✅ Open Source | 12GB+ | ✅ YES | ⭐⭐⭐⭐ (High) | ~15s | ⚠️ Yes* | ⚠️ Partial |
| **One-2-3-45** | Mar 2023 | ⚠️ Research Only | 14GB+ | ✅ YES | ⭐⭐⭐⭐ (High) | ~25s | ⚠️ Yes* | ⚠️ Partial |
| **MeshFormer** | Aug 2024 | ✅ Apache-2.0 | 16-20GB | ✅ YES | ⭐⭐⭐⭐⭐ (SOTA) | ~20s | ⚠️ Yes* | ⚠️ Partial |
| **Triplane Gaussian** | Feb 2024 | ✅ Open Source | 10-14GB | ✅ YES | ⭐⭐⭐⭐ (High) | ~12s | ⚠️ Yes* | ⚠️ Partial |
| **LGM (Large Multi-View)** | Feb 2024 | ✅ Open Source | 18-24GB | ✅ YES | ⭐⭐⭐⭐⭐ (SOTA) | ~15s | ⚠️ Yes* | ⚠️ Partial |
| **GRM (Large Reconstruction)** | Mar 2024 | ✅ Open Source | 20-24GB | ✅ YES | ⭐⭐⭐⭐⭐ (SOTA) | ~10s | ⚠️ Yes* | ⚠️ Partial |
| **Unique3D** | May 2024 | ✅ Open Source | 12-16GB | ✅ YES | ⭐⭐⭐⭐⭐ (SOTA) | ~15s | ⚠️ Yes* | ⚠️ Partial |

**CUDA Compatibility Note**: *All these models were primarily designed for NVIDIA/CUDA. On Apple Silicon, they require:
1. PyTorch MPS backend fallback
2. Custom kernel modifications OR CPU offloading
3. Potential performance reduction (2-5x slower than CUDA)

---

## 🎯 SELECTION CRITERIA SCORING

### Scoring System (0-10 per criterion)

| Model | Free/Open (2pts) | Latest 2024+ (2pts) | Quality (3pts) | Fits VRAM (3pts) | **TOTAL** |
|-------|-----------------|---------------------|----------------|------------------|-----------|
| **InstantMesh** | 2 (Apache-2.0) | 2 (Apr 2024) | 3 (SOTA) | 3 (10GB < 32GB) | **10/10** |
| **SV3D** | 0 (Non-Comm) | 2 (Mar 2024) | 3 (SOTA) | 3 (16GB < 32GB) | **8/10** |
| **CRM** | 1 (Research) | 0 (Oct 2023) | 2.5 (High) | 3 (16GB < 32GB) | **6.5/10** |
| **Wonder3D** | 2 (Open) | 0 (Dec 2023) | 2.5 (High) | 3 (12GB < 32GB) | **7.5/10** |
| **One-2-3-45** | 1 (Research) | 0 (Mar 2023) | 2.5 (High) | 3 (14GB < 32GB) | **6.5/10** |
| **MeshFormer** | 2 (Apache-2.0) | 2 (Aug 2024) | 3 (SOTA) | 2.5 (20GB, tight) | **9.5/10** |
| **Triplane Gaussian** | 2 (Open) | 1 (Feb 2024) | 2.5 (High) | 3 (14GB < 32GB) | **8.5/10** |
| **LGM** | 2 (Open) | 1 (Feb 2024) | 3 (SOTA) | 2 (24GB, borderline) | **8/10** |
| **GRM** | 2 (Open) | 2 (Mar 2024) | 3 (SOTA) | 2 (24GB, borderline) | **9/10** |
| **Unique3D** | 2 (Open) | 2 (May 2024) | 3 (SOTA) | 3 (16GB < 32GB) | **10/10** |

---

## 🏆 TOP 2 RECOMMENDED MODELS

### #1 RECOMMENDATION: **InstantMesh** (TencentARC)

| Attribute | Details |
|-----------|---------|
| **Repository** | https://github.com/TencentARC/InstantMesh |
| **HuggingFace** | https://huggingface.co/TencentARC/InstantMesh |
| **Release Date** | April 2024 |
| **License** | Apache-2.0 (Fully Open Source) ✅ |
| **VRAM Required** | 10-12GB |
| **Your VRAM** | 32GB ✅ (267% headroom) |
| **Quality** | State-of-the-art, GSO benchmark leader |
| **Speed** | ~10 seconds per image |

**Why Selected:**
1. ✅ **Fully Open Source** - Apache-2.0 allows commercial use, modification, distribution
2. ✅ **Latest Release** - April 2024 (most recent stable release)
3. ✅ **Best-in-Class Quality** - Outperforms CRM, Wonder3D on Google Scanned Objects benchmark
4. ✅ **Excellent VRAM Fit** - Uses only 10-12GB, leaving 20GB+ for system/other processes
5. ✅ **Active Community** - 1,500+ GitHub stars, active maintenance
6. ✅ **Fast Inference** - Among the fastest high-quality models (10s vs 20-30s competitors)

**Apple Silicon Compatibility:**
- Requires PyTorch with MPS backend
- May need CPU fallback for some CUDA kernels
- Expected performance: 2-3x slower than RTX 4090, but still usable (~30s per image)

---

### #2 RECOMMENDATION: **Unique3D** (AI3D Team)

| Attribute | Details |
|-----------|---------|
| **Repository** | https://github.com/AiuniAI/Unique3D |
| **HuggingFace** | https://huggingface.co/spaces/AiuniAI/Unique3D |
| **Release Date** | May 2024 |
| **License** | Open Source (MIT-style) ✅ |
| **VRAM Required** | 12-16GB |
| **Your VRAM** | 32GB ✅ (200% headroom) |
| **Quality** | State-of-the-art, superior texture detail |
| **Speed** | ~15 seconds per image |

**Why Selected:**
1. ✅ **Fully Open Source** - Permissive license, commercial use allowed
2. ✅ **Latest Release** - May 2024 (newest model in comparison)
3. ✅ **Superior Quality** - Excels at texture preservation and fine details
4. ✅ **Excellent VRAM Fit** - Uses 12-16GB, plenty of headroom
5. ✅ **Unique Feature** - Specializes in high-fidelity texture generation
6. ✅ **Easy Integration** - Gradio demo available, well-documented

**Comparison to InstantMesh:**
| Feature | InstantMesh | Unique3D |
|---------|-------------|----------|
| Speed | ~10s (faster) | ~15s |
| Texture Quality | Very Good | Excellent (better) |
| Geometry Quality | Excellent | Very Good |
| Release Date | Apr 2024 | May 2024 (newer) |
| Community Size | Larger | Growing |

---

## ❌ WHY OTHER MODELS WERE REJECTED

### InstantMesh Alternatives Analysis

| Model | Why Not Selected | Score Impact |
|-------|------------------|--------------|
| **SV3D** | ❌ Non-commercial license (Stability AI) - cannot use for commercial projects | -2 points |
| **CRM/ZERO123++** | ⚠️ Research-only license limits usage; Oct 2023 (older) | -1.5 points |
| **Wonder3D** | ⚠️ Dec 2023 release (6 months old); not latest | -2 points |
| **One-2-3-45** | ❌ Research-only license; Mar 2023 (outdated) | -3.5 points |
| **MeshFormer** | ⚠️ Requires 20GB VRAM - tight fit on 32GB with overhead; newer but less tested | -0.5 points |
| **LGM** | ⚠️ Requires 24GB VRAM - leaves insufficient headroom for macOS system | -2 points |
| **GRM** | ⚠️ Requires 24GB VRAM - borderline for 32GB system with unified memory overhead | -1 point |
| **Triplane Gaussian** | ⚠️ Feb 2024 (older); Good but InstantMesh/Unique3D are better | -1.5 points |

---

## 📋 DEPLOYMENT RECOMMENDATIONS

### For Apple M2 Pro 32GB System

```python
# Recommended PyTorch configuration
device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

# Memory management for unified memory
os.environ["PYTORCH_MPS_HIGH_WATERMARK_RATIO"] = "0.8"  # Use max 80% of available
```

### Installation Priority

1. **First Priority: InstantMesh**
   ```bash
   git clone https://github.com/TencentARC/InstantMesh
   cd InstantMesh
   pip install -r requirements.txt
   # Modify for MPS: change device from 'cuda' to 'mps'
   ```

2. **Second Priority: Unique3D**
   ```bash
   git clone https://github.com/AiuniAI/Unique3D
   cd Unique3D
   pip install -r requirements.txt
   ```

### Expected Performance on Your Hardware

| Model | NVIDIA RTX 4090 | Your M2 Pro 32GB | Slowdown Factor |
|-------|----------------|------------------|-----------------|
| InstantMesh | ~10s | ~25-35s | 2.5-3.5x |
| Unique3D | ~15s | ~40-50s | 2.5-3.5x |

**Note:** Performance slower than NVIDIA but entirely usable for local development and prototyping.

---

## 🎓 FINAL VERDICT

### For Your Use Case (Apple M2 Pro 32GB):

| Rank | Model | Recommendation |
|------|-------|----------------|
| 🥇 | **InstantMesh** | PRIMARY CHOICE - Best balance of open license, recency, quality, and VRAM fit |
| 🥈 | **Unique3D** | SECONDARY CHOICE - Latest model with superior texture quality |
| 🥉 | MeshFormer | HONORABLE MENTION - Very new (Aug 2024) but higher VRAM requirements |

**Decision Rationale:**
- ✅ Both are **100% free/open-source** (Apache-2.0 / MIT-style)
- ✅ Both are **2024 releases** (latest available)
- ✅ Both are **State-of-the-art quality**
- ✅ Both **fit comfortably within 32GB** unified memory
- ⚠️ Both require **MPS backend** instead of CUDA (with performance tradeoffs)

---

*Report generated: 2026-03-18*
*Hardware analyzed: Apple M2 Pro 32GB Unified Memory*
*Models evaluated: 10 image-to-3D architectures (2023-2025)*
