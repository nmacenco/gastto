
## Tabla Resumen — Épica 4

| ID      | Título corto                                  | Release | Story Points | Dependencias       | Link                                                                |
| ------- | --------------------------------------------- | ------- | ------------ | ------------------ | ------------------------------------------------------------------- |
| HU-4.01 | Conectar cuenta de almacenamiento             | MVP     | 5            | -                  | [[HU-4.01 — Conectar cuenta de almacenamiento en la nube]]          |
| HU-4.02 | Seleccionar archivo de planilla               | MVP     | 3            | HU-4.01            | [[HU-4.02 — Seleccionar el archivo de planilla]]                    |
| HU-4.03 | Seleccionar hoja de registros                 | MVP     | 2            | HU-4.02            | [[HU-4.03 — Seleccionar la hoja de registros]]                      |
| HU-4.04 | Leer y validar acceso a la planilla           | MVP     | 3            | HU-4.03            | [[HU-4.04 — Leer y validar acceso a la planilla]]                   |
| HU-4.05 | Inferir y proponer mapeo de columnas          | MVP     | 5            | HU-4.04            | [[HU-4.05 — Inferir y proponer el mapeo de columnas]]               |
| HU-4.06 | Confirmar o corregir el mapeo                 | MVP     | 3            | HU-4.05            | [[HU-4.06 — Confirmar o corregir el mapeo de columnas]]             |
| HU-4.07 | Confirmar categorías de la planilla           | MVP     | 3            | HU-4.06            | [[HU-4.07 — Confirmar las categorías de la planilla]]               |
| HU-4.08 | Configure linked categories and subcategories | R2      | 8            | HU-4.06, HU-4.07   | [[HU-4.08 — Configure linked categories and subcategories]] |
|         | **Total Épica 4 MVP**                         |         | **24 SP**    |                    |                                                                     |
|         | **Total Épica 4 R2**                          |         | **8 SP**     |                    |                                                                     |
|         | **Total Épica 4**                             |         | **32 SP**    |                    |                                                                     |

---

**Planning note:** HU-4.01 through HU-4.04 form a linear chain that must be complete before HU-4.05 can be estimated accurately. I recommend sprint 0 or sprint 1 for HU-4.01 + HU-4.02 + HU-4.03 in parallel with infrastructure, followed by HU-4.04 + HU-4.05 + HU-4.06 + HU-4.07 in sprint 2. Completing HU-4.07 is the entry gate for the first Epic 1 sprint. HU-4.08 extends this flow in Release 2 without blocking spreadsheets that retain a flat vocabulary.
