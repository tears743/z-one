# Task Progress: CUDA_to_MPS_Transpiler

**Task ID**: scan_cuda_refs
**Session ID**: 45e94c16-7c93-48e9-8eda-0415ea0d860f
**Status**: completed
**Time**: 2026-03-18T14:35:40.607Z

## Task Description
Scan the entire repository source code (especially run.py, app.py, and files in src/ directory) for CUDA-specific code patterns: torch.cuda, .cuda(), device='cuda', torch.cuda.is_available(), and nvdiffrast references. Create a detailed list of files and line numbers requiring modification.

## Result
## ✅ CUDA 代码扫描完成

我已完成对 InstantMesh 仓库的全面扫描。以下是关键发现：

---

### 📊 扫描摘要

| 类别 | 发现 |
|------|------|
| **包含 CUDA 模式的文件** | 12 个 |
| **需要修改的代码行** | ~30 行 |
| **nvdiffrast 引用** | 5 个文件，15+ 处调用 |
| **硬编码 `device='cuda'`** | 4 处 |
| **CUDA 专用依赖项** | 2 个（bitsandbytes, nvdiffrast） |

---

### 🔴 关键问题：nvdiffrast 库

**nvdiffrast** 是 NVIDIA 开发的 CUDA 光栅化库，**完全不支持 Apple Silicon**。

**影响的功能：**
- ❌ 纹理贴图 (Texture Map) 导出
- ❌ UV 展开和光栅化
- ❌ 网格渲染管线

**建议方案：**
使用顶点颜色代替纹理贴图（`save_obj()` 和 `save_glb()` 不依赖 nvdiffrast，可以正常工作）

---

### 🟡 需要修改的文件清单

| 文件 | 行号 | 问题类型 |
|------|------|---------|
| `run.py` | 83 | 硬编码 `device='cuda'` |
| `app.py` | 30-37, 75 | 硬编码 CUDA + 多 GPU 逻辑 |
| `src/model_mesh.py` | 78 | 分布式训练 CUDA 引用 |
| `src/models/lrm.py` | 6, 224 | nvdiffrast 导入和使用 |
| `src/models/lrm_mesh.py` | 6, 344 | nvdiffrast 导入和使用 |
| `src/utils/mesh_util.py` | 9, 170, 204 | nvdiffrast 光栅化调用 |
| `src/models/geometry/render/neural_render.py` | 7, 82, 136, 140 | nvdiffrast 渲染管线 |

---

### 📦 依赖项分析结果

**已移除的 CUDA 专用包：**
1. ❌ `nvdiffrast` - NVIDIA CUDA 光栅化库（完全不可用）
2. ❌ `bitsandbytes` - CUDA 量化库（不完全支持 ARM64）

**可用的 ARM64 兼容包：**
- ✅ PyTorch + MPS 后端
- ✅ transformers, diffusers, accelerate
- ✅ trimesh, PyMCubes, xatlas
- ✅ rembg (基于 ONNX Runtime，支持 MPS)

---

### 📄 生成的报告文件

1. **`cuda_code_scan_report.md`** - 详细的代码扫描报告（中文）
   - 包含所有需要修改的行号和修复建议
   
2. **`requirements_macos_arm64.txt`** - macOS ARM64 兼容的依赖项
   - 移除了 CUDA 专用包
   - 添加了安装说明和注意事项
   
3. **`CUDA_TO_MPS_MIGRATION_REPORT.md`** - 完整的迁移指南（英文）
   - 包含代码修改示例
   - 迁移实施计划

---

### 🎯 核心功能可用性

| 功能 | Apple Silicon 支持 |
|-----|-------------------|
| 多视图生成 | ✅ 支持 |
| 网格提取（顶点颜色） | ✅ 支持 |
| 网格导出 (.obj/.glb) | ✅ 支持 |
| 视频渲染 | ✅ 支持 |
| 纹理贴图导出 | ❌ 不支持 |
| 材质贴图 (.mtl) | ❌ 不支持 |

---

### ⏱️ 预计工作量

- **最小修复**（禁用纹理功能，仅设备选择修改）：~30 分钟
- **完整修复**（PyTorch3D 替换 nvdiffrast）：~4-6 小时

下一步建议：进行代码修改以支持 MPS 后端。