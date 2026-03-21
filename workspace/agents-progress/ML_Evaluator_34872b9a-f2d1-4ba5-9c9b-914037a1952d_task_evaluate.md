# Task Progress: ML_Evaluator

**Task ID**: task_evaluate
**Session ID**: 34872b9a-f2d1-4ba5-9c9b-914037a1952d
**Status**: started
**Time**: 2026-03-18T12:47:52.871Z

## Task Description
Read hf_candidates.json and gh_candidates.json. Compare all candidates on: output quality (mesh detail, texture support), inference speed, VRAM requirements (prefer <16GB for local run), ease of setup, and community support. Select the SINGLE best model for local deployment. Write selection to workspace/selected_model.json including: model name, source URL, clone/download command, dependencies list, and expected VRAM.