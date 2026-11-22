"""Pay calculations: a line-for-line port of packages/domain (TypeScript).

Pure functions, no I/O, integers only for money and time. The TypeScript is
the specification; tests/test_parity.py runs the cases it generated
(packages/domain/parity/vectors.json) through this code and requires the same
answers to the cent. Change the TypeScript first, regenerate the vectors, then
change this.

Stub lines and the other records are plain dicts with the same camelCase keys
as the app's JSON, so a value can go from request to calculation to response
without being renamed.
"""
