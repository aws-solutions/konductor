# Operations note

The checkout service loads the default configuration at process start in the
web application. This package loads a fresh copy when its public calculation
function is called, which keeps command-line tools simple. Configuration files
are kept small enough to review in a normal pull request.
