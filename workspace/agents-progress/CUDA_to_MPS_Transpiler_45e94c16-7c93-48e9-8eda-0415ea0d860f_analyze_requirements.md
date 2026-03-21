# Task Progress: CUDA_to_MPS_Transpiler

**Task ID**: analyze_requirements
**Session ID**: 45e94c16-7c93-48e9-8eda-0415ea0d860f
**Status**: completed
**Time**: 2026-03-18T14:36:34.576Z

## Task Description
Read the requirements.txt from the cloned InstantMesh repository. Identify all CUDA-specific dependencies (nvidia-ml-py, pynvml, xformers, nvdiffrast, etc.) that cannot be installed on Apple Silicon. Create a filtered list of installable packages suitable for macOS ARM64.

## Result
## ✅ CUDA 代码扫描完成

我已完成对 InstantMesh 仓库的全面扫描，以下是详细结果：

---

### 📊 扫描摘要

| 指标 | 数值 |
|-----|------|
| **扫描文件总数** | 20+ 个源文件 |
| **发现 CUDA 模式文件** | 12 个 |
| **需要修改的代码行** | ~30 行 |
| **CUDA 专用依赖项** | 2 个 |
| **nvdiffrast 引用** | 5 个文件，15+ 处调用 |

---

### 🔴 关键发现：nvdiffrast 障碍

**nvdiffrast** 是 NVIDIA 专用的 CUDA 光栅化库，**完全不支持 Apple Silicon**。

**受影响的功能：**
- ❌ 纹理贴图导出 (`save_obj_with_mtl()`)
- ❌ UV 展开光栅化 (`xatlas_uvmap()`)
- ❌ 网格渲染 (`NeuralRender`)

**可用的替代方案：**
- ✅ 顶点颜色导出 (`save_obj()`, `save_glb()`) - 不依赖 nvdiffrast
- ✅ PyTorch3D 替换 (支持 MPS，但需要 4-6 小时工作量)

---

### 📝 生成的报告文件

| 文件 | 路径 | 内容 |
|-----|------|------|
| **代码扫描报告** | `/Users/tj/workspace/z-one/cuda_code_scan_report.md` | 详细的文件、行号、修复建议 |
| **依赖项列表** | `/Users/tj/workspace/z-one/requirements_macos_arm64.txt` | 移除 CUDA 依赖的 requirements |
| **迁移指南** | `/Users/tj/workspace/z-one/instantmesh-research/CUDA_TO_MPS_MIGRATION_REPORT.md` | 完整的迁移计划和代码示例 |
| **执行摘要** | `/Users/tj/workspace/z-one/cuda_scan_summary.md` | 快速参考总结 |

---

### 🔧 需要修改的关键文件

```
1. run.py:83              → 硬编码 device='cuda'
2. app.py:30-37           → 多 GPU CUDA 逻辑
3. app.py:75              → 硬编码 device='cuda'
4. src/model_mesh.py:78   → 分布式训练 CUDA
5. src/utils/mesh_util.py:9,170,204 → nvdiffrast 导入和调用
6. src/models/lrm.py:6,224 → nvdiffrast 导入和上下文
7. src/models/lrm_mesh.py:6,344 → nvdiffrast 导入和调用
8. src/models/geometry/render/neural_render.py:7,82,136,140 → nvdiffrast 渲染管线
```

---

### 📦 依赖项修改

**需要移除：**
```bash
❌ git+https://github.com/NVlabs/nvdiffrast/  (CUDA 光栅化)
❌ bitsandbytes                               (CUDA 量化)
```

**保留并支持 MPS：**
```bash
✅ torch, torchvision, torchaudio  (MPS 后端)
✅ pytorch-lightning
✅ diffusers, transformers
✅ trimesh, PyMCubes, xatlas
✅ gradio, rembg
```

---

### 🚀 建议的迁移路径

| 方案 | 工作量 | 纹理贴图支持 | 推荐度 |
|-----|--------|-------------|--------|
| **最小修复** (禁用纹理) | 30 分钟 | ❌ | ⭐⭐⭐⭐⭐ |
| **PyTorch3D 替换** | 4-6 小时 | ✅ | ⭐⭐⭐ |
| **功能降级** | 1-2 小时 | ❌ | ⭐⭐⭐⭐ |

**我的建议：** 采用最小修复方案，禁用纹理贴图功能，仅使用顶点颜色导出。这在大多数 3D 软件中都能正常工作，且工作量最小。

---

### 💡 快速修复示例

**设备选择修改：**
```python
# 从:
device = torch.device('cuda')

# 改为:
device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
```

**纹理贴图禁用：**
```python
# 在 extract_mesh() 中:
if device.type in ['mps', 'cpu']:
    use_texture_map = False  # 强制使用顶点颜色
```

---

所有报告已保存到工作目录，可以直接查看详细分析和代码示例！