import { StatusCodes } from "http-status-codes";

export const errorHandler = (err, req, res, next) => {
  let customError = {
    statusCode: err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR,
   
    msg: err.statusCode ? err.message : "Something went wrong try again later",
  };

  if (err?.code === "ER_DUP_ENTRY") {
    customError.statusCode = StatusCodes.BAD_REQUEST;
    customError.msg = "Duplicate value entered for a unique field";
  }

  if (customError.statusCode === StatusCodes.INTERNAL_SERVER_ERROR) {
    console.error(err);
  }

  return res.status(customError.statusCode).json({ msg: customError.msg });
};

// A request that matched no route ends here, so the client gets JSON, not HTML.
export const notFound = (req, res) =>
  res.status(StatusCodes.NOT_FOUND).json({ msg: "Route not found" });
