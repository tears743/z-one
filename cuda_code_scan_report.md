# InstantMesh CUDA 代码扫描报告
## Apple Silicon (MPS) 兼容性分析报告

### 生成时间: 2026-03-18
### 扫描范围: /Users/tj/workspace/z-one/instantmesh-research/

---

## 📊 执行摘要

**关键发现:**
- 发现 **7 个文件** 包含 CUDA 硬编码设备引用
- 发现 **1 个关键 NVIDIA 库依赖** (nvdiffrast) - **ARM64 不兼容**
- 发现 **2 处** `torch.cuda.is_available()` 检查
- 发现 **多处** `device='cuda'` 硬编码
- 所有模型加载使用 `map_location='cpu'` (✅ 良好实践)

**兼容性评级: ⚠️ 中等 - 需要修改**

---

## 🔴 关键 CUDA 代码模式清单

### 1. 设备硬编码问题

#### 📁 `run.py` - Line 83
```python
device = torch.device('cuda')
```
**问题:** 硬编码 CUDA 设备
**修复:** 
```python
device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
```

---

#### 📁 `app.py` - Lines 30-37
```python
if torch.cuda.is_available() and torch.cuda.device_count() >= 2:
    device0 = torch.device('cuda:0')
    device1 = torch.device('cuda:1')
else:
    device0 = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    device1 = device0
```
**问题:** 硬编码 CUDA 设备检查，多 GPU 逻辑
**修复:**
```python
if torch.backends.mps.is_available():
    device0 = torch.device('mps')
    device1 = torch.device('mps')
elif torch.cuda.is_available() and torch.cuda.device_count() >= 2:
    device0 = torch.device('cuda:0')
    device1 = torch.device('cuda:1')
else:
    device0 = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    device1 = device0
```

---

#### 📁 `app.py` - Line 75
```python
device = torch.device('cuda')
```
**问题:** 硬编码 CUDA 设备
**修复:** 同上

---

#### 📁 `src/model_mesh.py` - Line 78
```python
device = torch.device(f'cuda:{self.global_rank}')
```
**问题:** 分布式训练硬编码 CUDA
**修复:**
```python
if torch.backends.mps.is_available():
    device = torch.device('mps')
elif torch.cuda.is_available():
    device = torch.device(f'cuda:{self.global_rank}')
else:
    device = torch.device('cpu')
```

---

### 2. CUDA 特定库导入

#### 📁 `src/utils/mesh_util.py` - Line 9
```python
import nvdiffrast.torch as dr
```
**严重问题:** NVIDIA CUDA 光栅化库 - **ARM64 完全不支持**
**使用位置:**
- Line 170: `dr.interpolate()`
- Line 204: `dr.rasterize()`

**影响范围:**
- `xatlas_uvmap()` 函数依赖 nvdiffrast 进行 UV 贴图渲染
- 纹理贴图导出功能将无法工作

**可能的替代方案:**
- 使用 `PyTorch3D` (支持 MPS)
- 使用 `moderngl` (OpenGL-based)
- 跳过纹理贴图功能，仅使用顶点颜色

---

#### 📁 `src/models/lrm.py` - Line 6
```python
import nvdiffrast.torch as dr
```
**使用位置:**
- Line 224: `dr.RasterizeCudaContext(device=device)`

---

#### 📁 `src/models/lrm_mesh.py` - Line 6
```python
import nvdiffrast.torch as dr
```
**使用位置:**
- Line 344: `dr.RasterizeCudaContext(device=device)`

---

#### 📁 `src/models/geometry/render/neural_render.py` - Line 7
```python
import nvdiffrast.torch as dr
```
**使用位置:**
- Line 82: `self.ctx = dr.RasterizeCudaContext(device=device)`
- Line 136: `dr.DepthPeeler()`
- Line 140: `dr.antialias()`

---

### 3. 模型加载模式 (✅ 良好)

所有模型加载使用 `map_location='cpu'`，这是良好的做法:

#### ✅ `run.py` - Lines 98, 109
```python
state_dict = torch.load(unet_ckpt_path, map_location='cpu')
state_dict = torch.load(model_ckpt_path, map_location='cpu')['state_dict']
```

#### ✅ `app.py` - Lines 91, 100
```python
state_dict = torch.load(unet_ckpt_path, map_location='cpu')
state_dict = torch.load(model_ckpt_path, map_location='cpu')['state_dict']
```

#### ✅ `src/model_mesh.py` - Line 50
```python
sd = torch.load(init_ckpt, map_location='cpu')['state_dict']
```

---

### 4. 张量设备操作

#### 📁 `run.py` - Lines 140, 147, 150, 153, 159
```python
input_cameras = get_zero123plus_input_cameras(...).to(device)
images = images.unsqueeze(0).to(device)
indices = torch.tensor([0, 2, 4, 5]).long().to(device)
input_cameras = input_cameras[:, indices].to(device)
render_cameras = get_render_cameras(...).to(device)
```
**状态:** ✅ 使用变量 `device`，修复硬编码后自动兼容

---

#### 📁 `app.py` - Lines 113, 118, 144, 147, 163, 166
```python
input_cameras = get_zero123plus_input_cameras(...).to(device1)
render_cameras = get_render_cameras(...).to(device1)
images = images.unsqueeze(0).to(device1)
```
**状态:** ✅ 使用变量 device1，修复硬编码后自动兼容

---

## 📋 文件修改清单

| 文件路径 | 行号 | 问题类型 | 优先级 |
|---------|------|---------|--------|
| `run.py` | 83 | 硬编码 'cuda' | 🔴 高 |
| `app.py` | 30-37 | 硬编码 'cuda' + 多 GPU | 🔴 高 |
| `app.py` | 75 | 硬编码 'cuda' | 🔴 高 |
| `src/model_mesh.py` | 78 | 分布式 CUDA | 🟡 中 |
| `src/utils/mesh_util.py` | 9, 170, 204 | nvdiffrast 依赖 | 🔴 高 |
| `src/models/lrm.py` | 6, 224 | nvdiffrast 依赖 | 🔴 高 |
| `src/models/lrm_mesh.py` | 6, 344 | nvdiffrast 依赖 | 🔴 高 |
| `src/models/geometry/render/neural_render.py` | 7, 82, 136, 140 | nvdiffrast 依赖 | 🔴 高 |

---

## ⚠️ 关键问题: nvdiffrast 库

**nvdiffrast** 是 NVIDIA 开发的 CUDA 光栅化库，**完全不支持 Apple Silicon**。

### 影响的功能:
1. ❌ 纹理贴图 (Texture Map) 导出 - `save_obj_with_mtl()`
2. ❌ UV 展开和光栅化 - `xatlas_uvmap()`
3. ❌ 网格渲染 - `NeuralRender.render_mesh()`
4. ❌ FlexiCubes 网格提取中的纹理生成

### 建议的解决方案:

#### 选项 A: 禁用纹理贴图功能 (最简单)
仅使用顶点颜色导出 (`.obj` 或 `.glb`)，这是一个可行的解决方案，因为：
- `save_obj()` 和 `save_glb()` 不依赖 nvdiffrast
- 顶点颜色在大多数 3D 软件中都能正常工作

#### 选项 B: 用 PyTorch3D 替换 nvdiffrast (中等复杂度)
PyTorch3D 支持 MPS 后端，但需要重写：
- `mesh_util.py` 中的光栅化逻辑
- `NeuralRender` 类的渲染方法

#### 选项 C: 使用纯 PyTorch 实现 (最高复杂度)
用 PyTorch 操作重写光栅化逻辑，性能可能较低。

---

## 🟢 无需修改的代码

以下代码模式在修改 `device` 变量后自动兼容:

1. ✅ 使用 `.to(device)` 的设备转移
2. ✅ `map_location='cpu'` 的模型加载
3. ✅ `torch.no_grad()` 上下文
4. ✅ 标准 PyTorch 神经网络操作
5. ✅ einops 操作
6. ✅ diffusers 和 transformers 库调用

---

## 📝 总结

### 需要修复的关键点:
1. **4 处** 硬编码 `device='cuda'` 需要改为设备无关代码
2. **nvdiffrast** 库需要替换或禁用相关功能
3. **纹理贴图导出** 功能在 Apple Silicon 上将不可用

### 核心功能可用性:
| 功能 | Apple Silicon 支持 |
|-----|-------------------|
| 多视图生成 | ✅ 支持 |
| 网格提取 (顶点颜色) | ✅ 支持 |
| 网格导出 (.obj/.glb) | ✅ 支持 |
| 视频渲染 | ✅ 支持 |
| 纹理贴图导出 | ❌ 不支持 |
| 材质贴图 (.mtl) | ❌ 不支持 |

### 估计工作量:
- **最小修复** (禁用纹理功能): ~30 分钟
- **完整修复** (PyTorch3D 替换): ~4-6 小时

---

*报告生成: CUDA_to_MPS_Transpiler Agent*
*扫描目录: /Users/tj/workspace/z-one/instantmesh-research/*
