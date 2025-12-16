# RNE Headless Service

24/7 racing content ingestion for AI learning. Watches YouTube racing content from F1, IMSA, WEC, NASCAR, IndyCar, simracing, and more.

## Quick Start

```bash
# Install dependencies
npm install

# Run in development
npm run dev

# Build for production
npm run build
npm start
```

## Docker Deployment

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f

# Check health
curl http://localhost:8080/health
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BRAIN_ENDPOINT` | DO app URL | ControlBox server URL |
| `BRAIN_API_KEY` | dev-watcher-key | Authentication key |
| `MAX_STREAMS` | 2 | Concurrent video streams |
| `ROTATION_MINUTES` | 20 | Time before switching sources |
| `CAPTURE_FPS` | 1 | Frames per second to capture |
| `HEADLESS` | true | Run browser headless |
| `HEALTH_PORT` | 8080 | Health check HTTP port |

## Racing Sources (13 categories)

- **F1**: Official channel, highlights
- **IMSA**: SportsCar racing
- **WEC**: World Endurance, Le Mans
- **NASCAR**: Oval racing
- **IndyCar**: American open-wheel
- **Simracing**: iRacing, ACC, The Sim Grid
- **GT**: GT World Challenge
- **Rally**: WRC
- **Formula E**: Electric racing

## Resource Requirements

| Streams | RAM | vCPUs | Est. Cost/mo |
|---------|-----|-------|--------------|
| 1-2 | 2GB | 1 | $12 |
| 3-4 | 4GB | 2 | $24 |
| 6-8 | 8GB | 4 | $48 |
