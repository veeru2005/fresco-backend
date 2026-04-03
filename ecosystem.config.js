module.exports = {
  apps: [
    {
      name: "fresco-backend",
      script: "./server.js",
      instances: 1,
      exec_mode: "fork",
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
