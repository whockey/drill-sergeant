import Twilio, { twiml } from "twilio";

import BodyParser from "body-parser";
import Cron from "cron";
import Express from "express";
import M from "moment";
import Redis from "redis";
import { promisify } from "util";

const accountSid = "AC53f46be8d6f0a6b7737777c75f102feb";
const authToken = "69ddf27362642bace2a500254ca69590";

const twilio = Twilio(accountSid, authToken);
const redis = Redis.createClient({
  host: "redis",
  port: 6379
});

const CronJob = Cron.CronJob;

const redisGet = promisify(redis.get).bind(redis);
const redisSet = promisify(redis.set).bind(redis);
const redisKeys = promisify(redis.keys).bind(redis);

// ---------------- API ------------------
const app = Express();
app.use(BodyParser.urlencoded({ extended: true }));

app.get("/", async (req, res) => {
  res.send("ok");
});

app.post("/message", async (req, res) => {
  // Checking on the legitimacy of request
  if (req.body.AccountSid != accountSid) {
    return res.status(404).send("Not found");
  }
  // Twilio requires response to be in XML in reply to webhooks
  // :shrugs:
  res.type("text/xml");

  //Numbers are in format whatsapp:+18037389815'
  const number = /whatsapp:(.*)/.exec(req.body.From)[1];
  const message = req.body.Body;

  try {
    const response = await runTask(number, message);
    console.log(`Message was: ${message}`);
    console.log(`Sending response: ${response}`);
    res.send(response);
  } catch (err) {
    console.log(`Error recieved: ${err}`);
    console.log(err);
    console.log(`Original request was: ${JSON.stringify(req.body)}`);
    res.send(err);
  }
});

app.listen(8080, () => console.log("Listening"));

// Main logic
// Interprets message and tries to operate task

async function runTask(number: string, message: string) {
  const command = /^([^\s]+)\s*/.exec(message);
  const task = message.replace(command[0], "");
  const commandTest = new RegExp(command[1], "i");

  const today = new Date().toLocaleDateString();

  const redisNumber = await redisGet(`numbers-${number}`);

  let allTasks: object;

  if (!redisNumber) {
    allTasks = {};
    allTasks[today] = {};
  } else {
    allTasks = JSON.parse(redisNumber);
    // TODO this should never happen if the cron job is running properly
    if (!allTasks[today]) {
      allTasks[today] = {};
    }
  }

  if (commandTest.test("add")) {
    allTasks[today][task] = false;
  } else if (commandTest.test("remove")) {
    delete allTasks[today][task];
  } else if (commandTest.test("complete")) {
    const matchedKey = Object.keys(allTasks[today]).filter(key =>
      new RegExp(task, "i").test(key)
    );
    if (matchedKey) allTasks[today][matchedKey[0]] = true;
  } else if (commandTest.test("list")) {
  } else if (commandTest.test("historical")) {
    return formatHistorical(allTasks);
  } else {
    throw "unknown command";
  }
  await redisSet(`numbers-${number}`, JSON.stringify(allTasks));
  return formatTwilioMessage(allTasks, "xml");
}

function formatHistorical(historicalTasks: object) {
  // Puts the last 30 days on an array
  let calendar = "";
  for (let i = 30; i >= 0; i--) {
    const currentDate = M().subtract(i, "days");
    const key = currentDate.toDate().toLocaleDateString();

    // If we found any tasks in this day that were false
    // then it wasn't a success
    if (historicalTasks[key] && Object.keys(historicalTasks[key]).length) {
      const success = !Boolean(
        // Looking for any tasks that are false
        Object.keys(historicalTasks[key]).find(t => !historicalTasks[key][t])
      );
      calendar += success ? "✅ " : "⬜ ";
    } else {
      calendar += "⬜ ";
    }
    if (currentDate.day() % 7 == 0) {
      calendar += "\n";
    }
  }
  calendar += "\n";
  return new twiml.MessagingResponse().message(calendar).toString();
}

function formatTwilioMessage(message: object, type: string) {
  const today = new Date().toLocaleDateString();
  let formattedString = "*Daily Tasks*\n";
  Object.keys(message[today]).forEach(task => {
    const emoji = message[today][task] ? "✅" : "⬜";
    formattedString = formattedString.concat(`${emoji} - ${task}\n`);
  });
  if (type === "xml") {
    return new twiml.MessagingResponse().message(formattedString).toString();
  } else {
    return formattedString;
  }
}

// ---- Recuring events ----------------------

console.log("Setting cron jobs");
const newDayCron = new CronJob(
  "0 00 * * *",
  async () => await startNewDay(),
  null,
  true,
  "America/Los_Angeles"
);
const messageCron = new CronJob(
  "0 08 * * *",
  async () => await sendMorningMessage(),
  null,
  true,
  "America/Los_Angeles"
);
console.log(
  `newDayCron... running: ${
    newDayCron.running
  }, next 5 times: ${newDayCron.nextDates(5).toString()}`
);

console.log(
  `messageCron... running: ${
    messageCron.running
  }, next 5 times: ${messageCron.nextDates(5).toString()}`
);

async function sendMorningMessage() {
  console.log("Starting to send morning messages");
  // Get all phone numbers
  const numbers = await redisKeys("numbers-*");
  for (let i = 0; i < numbers.length; i++) {
    const allTasks = JSON.parse(await redisGet(numbers[i]));
    console.log(`About to send message to ${numbers[i]}`);
    console.log(formatTwilioMessage(allTasks, "string"));
    const response = await twilio.messages.create({
      from: "whatsapp:+14155238886",
      to: `whatsapp:${numbers[i].replace("numbers-", "")}`,
      body: formatTwilioMessage(allTasks, "string")
    });
    console.log(response);
  }
}

async function startNewDay() {
  // Get all phone numbers
  console.log("Starting a new day.");
  const numbers = await redisKeys("numbers-*");
  console.log(`Setting numbers: ${numbers}`);
  for (let i = 0; i < numbers.length; i++) {
    // Get all tasks associated with the number
    const allTasks = JSON.parse(await redisGet(numbers[i]));

    // helper variables for yesterday and today
    // MM/DD/YYYY
    const today = new Date().toLocaleDateString();
    const yesterday = new Date(
      new Date().setDate(new Date().getDate() - 1)
    ).toLocaleDateString();

    // Set today's tasks to be the same as yesterday's tasks
    const todaysTasks = Object.assign({}, allTasks[yesterday]);

    // Zero out all of today's task.
    Object.keys(todaysTasks).forEach(t => (todaysTasks[t] = false));

    // Attach today's tasks to the number object
    allTasks[today] = todaysTasks;

    // write back to redis
    await redisSet(numbers[i], JSON.stringify(allTasks));
  }
}
