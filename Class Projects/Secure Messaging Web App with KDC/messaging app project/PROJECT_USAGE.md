Our project is a web application that involves the client/server architecture, and a separate KDC that manages session keys between users and the server.

## Website usage

It is deployed on websites in production mode, and can be accessed at this url:

https://cs4310-messaging-app-35b647f5f3d0.herokuapp.com/

It uses a MongoDB hooked up to Logan's account, and if you want to see it, you can ask him to login and show you what is happening on the backend. The same goes for the KDC, which is hosted on a Redis database on his account. We are unable to share the credentials for these databases.

Note that the KDC does not have a GUI, and is an API only. It is hosted at this url, if you are curious:

https://kdc-simulation.vercel.app/


## Running the project locally

If you want to run it locally, so that you can see the logs, you can run it in development mode. It will use the same MongoDB and Redis databases as the web deployment, because local databases were too inconvenient to set up and maintain.

You will need to have Node.js installed on your machine.

1. **One-time Setup**: Install all dependencies for the entire system (Root, KDC, Server, and Client):
   ```bash
   npm run install-all
   ```

2. **Local Development**: Start the KDC and the Messaging App (Client + Server) simultaneously:
   ```bash
   npm run dev
   ```

If any other processes are running on the default ports (localhost:3000, localhost:5001, localhost:5000), you may need to stop them or change the ports in the .env files.

It should open automatically, but if it doesn't, you can access the client at http://localhost:3000

---

If you have any questions about the code or the project, feel free to ask us!