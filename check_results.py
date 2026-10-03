import json

for name, path in [("DEV", "data/eval_dev.json"), ("HELD-OUT", "data/eval_heldout.json")]:
    r = json.load(open(path, encoding="utf-8"))
    print(f"\n{name}: evaluated {r['evaluated']}/{r['total_questions']}")
    for pipe in ["generic", "curriculum"]:
        o = r["overall"][pipe]
        print(f"  {pipe:>12}: P@3={o['precision']:.3f}  HR@3={o['hit_rate']:.3f}  MRR={o['mrr']:.3f}")