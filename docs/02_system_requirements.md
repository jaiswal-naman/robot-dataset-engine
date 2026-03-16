# AutoEgoLab v3.0: 2. System Requirements

## Functional Requirements
- **Video Upload**: Users can seamlessly drag-and-drop a 5-minute MP4 file.
- **Orchestrated Processing**: The system must automatically route the video through 7 specialized AI agents.
- **Real-time Status Updates**: The UI must reflect exactly which agent is running or completed.
- **Result Visualization**: Render clear task graphs, extracted skills, quality metrics, and downloadable JSON/RLDS packages.

## Non-Functional Requirements
- **Latency**: End-to-end processing for a 5-minute video ≤ 5 minutes.
- **Throughput**: Support concurrent processing of at least 10 simultaneous demo users.
- **Reliability**: 99.9% uptime for the orchestrator, with aggressive retry logic for GPU container timeouts.
- **Cost Constraints**: Keep the platform running wholly on free-tier or strongly capped credit structures ($0/mo target).
- **Scalability**: Modal.com Serverless GPU functions must scale to 0 when idle and scale linearly under load.
