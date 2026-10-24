"""No Google SDK or credentials: these records are deliberately fictional."""
PROJECT = "gcp-copilot-demo"
BUCKETS = [
    {"name": "demo-documents-private", "location": "US", "public": False},
    {"name": "demo-public-assets", "location": "SOUTHAMERICA-EAST1", "public": True},
]
VMS = [
    {"name": "demo-api-01", "zone": "us-central1-a", "status": "RUNNING", "machine_type": "e2-small"},
    {"name": "demo-worker-01", "zone": "us-central1-b", "status": "TERMINATED", "machine_type": "e2-medium"},
]
DATASETS = [{"name": "demo_analytics", "location": "US", "tables": ["events", "daily_usage"]}]
