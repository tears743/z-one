# InstantMesh Remote Skill

## Overview

A reusable skill for remote image-to-3D conversion using TencentARC/InstantMesh deployed on a remote server.

## Features

- 🖼️ Convert single images to 3D meshes remotely
- 🌐 Support for both local files and URLs
- ⚙️ Configurable parameters (model config, threshold, etc.)
- 📥 Automatic result retrieval
- 🔒 SSH-based secure communication
- 📊 Progress reporting and error handling
- 🖥️ Works with Windows/Linux remote servers

## Prerequisites

### 1. SSH Key Authentication (REQUIRED)

Before using this skill, you must configure SSH key authentication to the remote server:

**Your Public Key:**
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKiIOJ3lDShZhRMADGb9H2Jilt0C4SUwuy9qLaKxeqZm tj@tangjiandeMac-mini.local
```

**On Remote Windows Server (as Admin):**
```powershell
# Create SSH directory
mkdir -p C:\Users\Admin\.ssh

# Add your public key
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKiIOJ3lDShZhRMADGb9H2Jilt0C4SUwuy9qLaKxeqZm tj@tangjiandeMac-mini.local" > C:\Users\Admin\.ssh\authorized_keys

# Set permissions
icacls C:\Users\Admin\.ssh\authorized_keys /inheritance:r
icacls C:\Users\Admin\.ssh\authorized_keys /grant:r "Admin:(R)"
```

**Test Connection:**
```bash
ssh -o PasswordAuthentication=no Admin@100.69.228.96 whoami
```

### 2. Remote Server Requirements

- **OS:** Windows 10/11 (with OpenSSH) or Linux
- **Python:** 3.9+ with virtual environment
- **GPU:** NVIDIA GPU with CUDA (recommended) or CPU
- **RAM:** 16GB+ (32GB recommended)
- **Disk:** 50GB+ free space
- **InstantMesh:** Deployed and configured

## Installation

```bash
# The skill is automatically available in z-one
# Just ensure SSH keys are configured
```

## Configuration

Create `~/.z-one/skills/instantmesh_remote/config.yaml`:

```yaml
# Remote server configuration
remote:
  host: "100.69.228.96"
  user: "Admin"
  port: 22
  key_path: "~/.ssh/id_ed25519"
  
  # Remote paths
  work_dir: "C:/InstantMesh/workspace"  # Windows
  # work_dir: "/home/admin/instantmesh"  # Linux
  
  # InstantMesh config
  instantmesh:
    config: "configs/instant-mesh-large.yaml"
    isosurface_threshold: 27
    use_texture_map: false
    
# Local settings
local:
  output_dir: "./outputs"
  keep_temp_files: false
  
# Transfer settings
transfer:
  compression: true
  bandwidth_limit: "10M"  # Limit bandwidth for large files
```

## Usage

### Basic Usage

```python
from instantmesh_remote import InstantMeshRemote

# Initialize
converter = InstantMeshRemote()

# Convert local image
result = converter.convert(
    input_path="/path/to/image.jpg",
    output_name="my_model"
)

# Access outputs
print(result["mesh_obj"])    # Path to .obj file
print(result["mesh_glb"])    # Path to .glb file
print(result["video"])       # Path to video preview
```

### Convert from URL

```python
result = converter.convert(
    input_url="https://example.com/image.jpg",
    output_name="downloaded_model"
)
```

### Advanced Options

```python
result = converter.convert(
    input_path="/path/to/image.png",
    output_name="custom_model",
    config="configs/instant-mesh-base.yaml",  # Use smaller model
    isosurface_threshold=30,
    remove_background=True,
    output_formats=["obj", "glb", "video"]
)
```

### Check Remote Status

```python
# Check if remote server is ready
status = converter.check_remote_status()
print(f"GPU Available: {status['gpu']}")
print(f"CUDA Version: {status['cuda']}")
print(f"Memory: {status['memory_gb']}GB")
```

## API Reference

### `InstantMeshRemote`

#### Constructor

```python
InstantMeshRemote(config_path: str = None)
```

- `config_path`: Path to custom config file (optional)

#### Methods

##### `convert()`

```python
convert(
    input_path: str = None,
    input_url: str = None,
    output_name: str = None,
    config: str = None,
    isosurface_threshold: int = None,
    remove_background: bool = True,
    output_formats: List[str] = ["obj", "glb"]
) -> Dict[str, str]
```

**Parameters:**
- `input_path`: Local path to image file
- `input_url`: URL to download image from
- `output_name`: Base name for output files
- `config`: InstantMesh config file to use
- `isosurface_threshold`: Mesh extraction threshold
- `remove_background`: Use rembg to remove background
- `output_formats`: List of formats to generate

**Returns:**
Dictionary with paths to generated files:
```python
{
    "mesh_obj": "/path/to/model.obj",
    "mesh_glb": "/path/to/model.glb",
    "video": "/path/to/video.mp4",
    "metadata": "/path/to/info.json"
}
```

##### `check_remote_status()`

```python
check_remote_status() -> Dict[str, Any]
```

Returns remote system information including GPU, CUDA, memory status.

##### `test_connection()`

```python
test_connection() -> bool
```

Test SSH connection to remote server.

## Error Handling

The skill handles various error conditions:

| Error | Cause | Solution |
|-------|-------|----------|
| `SSHConnectionError` | Cannot connect to remote | Check network and SSH config |
| `AuthenticationError` | SSH key not accepted | Add public key to remote server |
| `RemoteNotReadyError` | InstantMesh not installed | Deploy InstantMesh on remote |
| `ConversionError` | Processing failed | Check logs and input image |
| `TransferError` | File upload/download failed | Check disk space and permissions |

## Troubleshooting

### SSH Connection Issues

```bash
# Test SSH manually
ssh -v -i ~/.ssh/id_ed25519 Admin@100.69.228.96

# Check key permissions
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub
```

### Windows-Specific Issues

If using Windows remote server:

1. Ensure OpenSSH server is installed:
   ```powershell
   Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
   ```

2. Check sshd service is running:
   ```powershell
   Get-Service sshd
   Start-Service sshd
   ```

3. Verify authorized_keys permissions:
   ```powershell
   icacls C:\Users\Admin\.ssh\authorized_keys
   ```

### Performance Tuning

For faster conversions:

```yaml
# In config.yaml
instantmesh:
  config: "configs/instant-mesh-base.yaml"  # Smaller model
  batch_size: 1
```

## Examples

See `examples/` directory for:
- `basic_conversion.py` - Simple image to 3D
- `batch_processing.py` - Process multiple images
- `url_conversion.py` - Convert from web images
- `custom_parameters.py` - Advanced configuration

## License

MIT License - See LICENSE file

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## Support

For issues and questions:
- GitHub Issues: [your-repo]/issues
- Documentation: [your-docs-url]
