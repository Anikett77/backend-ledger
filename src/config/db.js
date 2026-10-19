const mongoose = require("mongoose")



function connectToDB() {

   mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("Server is connected to DB");
    })
    .catch((error) => {
        console.error("Error connecting to DB:", error.message);
        process.exit(1);
    });
}

module.exports = connectToDB