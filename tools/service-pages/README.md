# Service page generator

The sixteen service pages (airport, hourly, corporate, Mayo Clinic, service area, …) are generated from
`page_specs.py` by `build_pages.py`, using `airport-pickup.html` as the shared skeleton (head, header, footer).

Edit copy in `page_specs.py`, then from the repo root run:

    python3 tools/service-pages/build_pages.py

Every page is rewritten in place. Header/footer changes made to `airport-pickup.html` propagate on the next build.
