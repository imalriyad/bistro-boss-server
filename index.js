const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_SECRET);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

// MiddleWare
app.use(express.json());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://bistrobosss.netlify.app",
    ],
    credentials: true,
  })
);

// varifyToken
const varifyToken = (req, res, next) => {
  console.log(req.headers?.authorization);
  if (!req.headers?.authorization) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  const token = req.headers.authorization.split(" ")[1];

  if (!token) {
    return res.status(401).send({ message: "Unauthorized" });
  }
  jwt.verify(token, process.env.SECRET_KEY, (error, decoded) => {
    if (error) {
      return res.status(401).send({ message: "Unauthorized" });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mp2awoi.mongodb.net/?retryWrites=true&w=majority`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const database = client.db("BistroDB");
    const foodCollection = database.collection("foods");
    const reviewCollection = database.collection("reviews");
    const cartCollection = database.collection("cart");
    const userCollection = database.collection("users");
    const paymentCollection = database.collection("payment");

    // varify admin
    const varifyAdmin = async (req, res, next) => {
      const email = req.user.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      next();
    };
    // get current user
    app.get("/api/v1/getUserRole/:email", varifyToken, async (req, res) => {
      const queryMail = req.params.email;
      const tokenEmail = req.user.email;
      console.log(tokenEmail, queryMail);
      if (queryMail !== tokenEmail) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      query = { email: queryMail };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user.role === "admin";
      }
      res.send({ admin });
    });

    //  Creating jwt token
    app.post("/api/v1/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.SECRET_KEY, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // Make admin
    app.patch(
      "/api/v1/make-admin/:id",
      varifyToken,
      varifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const user = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            role: user?.role,
          },
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    // Payment getway
    app.post("/api/v1/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/api/v1/save-payment-details", async (req, res) => {
      const payment = req.body;
      console.log(payment);
      const result = await paymentCollection.insertOne(payment);
      const filter = {
        $or: [
          { _id: { $in: payment.itemId.map((id) => new ObjectId(id)) } },
          { _id: { $in: payment.itemId.map((id) => id) } },
        ],
      };
      const deleteCart = await cartCollection.deleteMany(filter);
      res.send(result);
    });

    // delete user
    app.delete(
      "/api/v1/user/:id",
      varifyToken,
      varifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        const filter = { _id: new ObjectId(id) };
        const result = await userCollection.deleteOne(filter);
        res.send(result);
      }
    );

    // Get all user
    app.get("/api/v1/users", varifyToken, varifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    //  store all user info in db
    app.post("/api/v1/create-user", async (req, res) => {
      const user = req.body;
      const filter = { email: user.email };
      // Await the result of findOne
      const isExist = await userCollection.findOne(filter);

      if (isExist) {
        return res.send("Already have an account with this email");
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // Delete a item from cart
    app.delete("/api/v1/delete-from-cart/:id", async (req, res) => {
      const id = req.params.id;
      const filter = {
        $or: [{ _id: id }, { _id: new ObjectId(id) }],
      };

      const result = await cartCollection.deleteOne(filter);
      res.send(result);
    });

    // get from cart
    app.get("/api/v1/get-cart", async (req, res) => {
      const useremail = req.query.email;
      let query = {};
      if (useremail) {
        query = { email: useremail };
      }
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    // add to cart

    app.post("/api/v1/add-to-cart", async (req, res) => {
      const item = req.body;

      const query = {
        _id: new ObjectId(item._id),
        email: item.email,
      };

      // Check if the item with the same _id and email already exists in the cart
      const existingItem = await cartCollection.findOne(query);

      if (existingItem) {
        // If the item already exists, send an error response to the client
        return res
          .status(400)
          .json({ error: "Item already added to the cart" });
      }

      // Convert the _id to ObjectId before inserting
      item._id = new ObjectId(item._id);

      // If the item doesn't exist, insert it into the cart
      const result = await cartCollection.insertOne(item);

      // Send a success response to the client
      res.status(201).json({ insertedId: result.insertedId });
    });

    // add titem to foods/menu
    app.post("/api/v1/add-item", varifyToken, varifyAdmin, async (req, res) => {
      const item = req.body;
      const result = await foodCollection.insertOne(item);
      res.send(result);
    });

    app.delete("/api/v1/delete-from-foods/:id", async (req, res) => {
      const id = req.params.id;

      const filter = {
        $or: [{ _id: id }, { _id: new ObjectId(id) }],
      };

      const result = await foodCollection.deleteOne(filter);
      res.send(result);
    });

    app.get("/api/v1/get-all-foods", async (req, res) => {
      const result = await foodCollection.find().toArray();
      res.send(result);
    });

    app.get("/api/v1/get-reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Bistro Boss Server is running ...");
});

app.listen(port, () => {
  console.log(`Bistro Boss Server is running on port ${port}`);
});
