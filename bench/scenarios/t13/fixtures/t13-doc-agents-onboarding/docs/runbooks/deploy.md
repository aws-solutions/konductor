# Deployment notes

The deployment pipeline builds the service, runs static checks, and then starts
the selected artifact. Check the health endpoint after a change and retain the
request identifier when following a slow request through the logs.
