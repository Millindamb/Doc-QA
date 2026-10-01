#!/usr/bin/env python
"""Train the layer-2 intent classifier and save it with joblib.

    python train_router.py                       # uses data/intents.csv -> artifacts/router.joblib
    python train_router.py --data other.csv --out /tmp/router.joblib --folds 5

Prints stratified k-fold cross-validation metrics, then fits on ALL rows and saves.
"""
from __future__ import annotations

import argparse

import numpy as np
from sklearn.metrics import classification_report
from sklearn.model_selection import StratifiedKFold, cross_val_predict

from app.config import settings
from app.services.intent_router import build_pipeline, load_dataset, train_and_save


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", default=settings.router_data_path)
    parser.add_argument("--out", default=settings.router_model_path)
    parser.add_argument("--folds", type=int, default=5)
    args = parser.parse_args()

    queries, labels = load_dataset(args.data)
    print(f"dataset: {len(queries)} rows, {len(set(labels))} intents")

    if args.folds >= 2:
        cv = StratifiedKFold(n_splits=args.folds, shuffle=True, random_state=42)
        pred = cross_val_predict(build_pipeline(), queries, labels, cv=cv)
        acc = float(np.mean(np.array(pred) == np.array(labels)))
        print(f"\n{args.folds}-fold CV accuracy: {acc:.3f}\n")
        print(classification_report(labels, pred, digits=3))

    _, saved = train_and_save(args.data, args.out)
    print(f"saved model -> {saved}")


if __name__ == "__main__":
    main()
