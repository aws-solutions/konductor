# Small decisions

The service uses CommonJS to match the existing runtime image. It keeps cloud calls behind one wrapper so local tests do not require credentials or a network.
