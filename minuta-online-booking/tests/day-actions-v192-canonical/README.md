# Canonical scheduling fixture

Nine exact function definitions from the approved read-only production metadata export, run 45270253278, main 34d078517d591a9b15c2ef73702f0f4f2df5a55a.
No customer rows, trigger arguments, HTTP headers or credentials are included.
Used only inside the isolated rollback-only test transaction to align its scheduling source with the qualified production baseline; every change is rolled back.
The migration independently refuses drift in the four functions it patches. Underlying tenant, shift, resource and booking dependencies remain native to the test database; missing dependencies fail the test.
