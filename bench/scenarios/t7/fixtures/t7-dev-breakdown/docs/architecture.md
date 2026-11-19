# Catalog architecture

The route delegates to `catalog-service`, which validates request inputs, reads the repository, and serializes products. The repository currently reads the price stored on `products`. A small in-process cache sits between the service and repository. Notification and partner-export code each use the shared money formatter.

SQL migrations run in filename order during deployment. Existing production rows must remain readable throughout a rolling deployment.
