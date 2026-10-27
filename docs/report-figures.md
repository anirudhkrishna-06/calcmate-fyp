# Research report figures and evidence capture

The report figures are generated from the repository's canonical artefacts:

- `data/concepts.csv` and `data/prerequisite_edges.csv` for the full mathematics knowledge graph.
- `data/bkt_validation/summary.json` for learner-state estimation and convergence results.
- `data/stage4_evaluation_results.json` for the controlled scheduler-policy comparison.

## Generate the diagrams

From the repository root:

```powershell
python scripts/generate_report_figures.py
```

If the project virtual environment is active, the equivalent command is:

```powershell
.\venv\Scripts\python.exe scripts/generate_report_figures.py
```

The PNG files are suitable for report screenshots and the SVG files are suitable
for high-quality insertion into Word, PowerPoint, or LaTeX:

```text
outputs/01_curriculum_knowledge_graph.png
outputs/02_learner_state_estimation.png
outputs/03_scheduler_policy_metrics.png
outputs/*.svg
outputs/figure_manifest.json
```

## Capture backend and algorithm evidence

These commands produce terminal evidence that can be captured with Windows
Snipping Tool or exported from the terminal. Run them from the repository root:

```powershell
python -m src.research_demo graph
python -m src.research_demo traverse --concept M404
python -m src.research_demo estimate
python -m src.research_demo classroom --students 24 --seed 42
python -m src.research_demo simulate --students 24 --minutes 180 --seed 42
python -m src.research_demo evaluate --seeds 1 2 3 4 5
```

The simulation command writes a reproducible schedule draft under
`data/demo_output/`. The evaluation command writes/updates the controlled
policy results used by the third figure.

## Capture verification evidence

```powershell
.\venv\Scripts\python.exe -m pytest -q tests
Push-Location frontend
npm.cmd run typecheck
npm.cmd run test:db
npm.cmd run test:scheduling
node tests/curriculum-graph.cjs
npm.cmd run test:workspace-ui
npm.cmd run test:chat-ui
Pop-Location
```

For a live backend health screenshot, start the API in one terminal:

```powershell
.\venv\Scripts\python.exe -m uvicorn src.rag_api:app --host 127.0.0.1 --port 8000
```

Then open `http://127.0.0.1:8000/health` in a browser and capture the response.
This health check is separate from the local non-RAG scheduler and classroom
state, so do not present it as evidence that the scheduler requires the RAG API.

## Interpretation note for the report

The learner-state figure deliberately includes BKT as a baseline and identifies
the estimator that passes the current validation gate. The scheduler figure
emphasises the graph-aware safety result: CALCMATE records zero mean
prerequisite violations in the checked policy comparison. Report these as
simulated/controlled results, not as field-trial learning gains.
