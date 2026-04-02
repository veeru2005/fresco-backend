module.exports = {
  apps: [
    {
      name: "fresco-backend",
      script: "./server.js",
      instances: "max", // Uses all available CPU cores on the VM
      exec_mode: "cluster", // Enables Node.js clustering for 150+ concurrent users
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
        // MONGO_URI, JWT_SECRET, PORT will be loaded from the VM's environment or .env file
      }
    }
  ]
}
