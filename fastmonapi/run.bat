@echo off
cd /d %~dp0
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 3000 --workers 4
